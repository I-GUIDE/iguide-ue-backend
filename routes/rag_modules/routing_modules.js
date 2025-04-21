import { callLlamaModel, createQueryPayload, callGPTModel } from './llm_modules.js';
import { getKeywordSearchResults, getSemanticSearchResults, getNeo4jSearchResults} from './search_modules.js';
import { getSpatialSearchResults } from './spatial_search_modules.js';
import fs from 'fs';
import csv from 'csv-parser';
import { get } from 'http';


// Load search methods from CSV
async function loadSearchMethods() {
  return new Promise((resolve, reject) => {
    const methods = [];
    fs.createReadStream('./routes/rag_modules/search_methods.csv')
      .pipe(csv())
      .on('data', (row) => {
        methods.push({
          functionName: row.function_name,
          description: row.description,
        });
      })
      .on('end', () => {
        resolve(methods);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

// Generate the LLM prompt based on the user query and search methods
async function generateRoutingPrompt(userQuery, searchMethods) {
  let prompt = `The user has the following query: "${userQuery}". Below is a list of search methods and their descriptions:\n\n`;

  searchMethods.forEach((method) => {
    prompt += `- ${method.functionName}: ${method.description}\n`;
  });

  prompt += `\nBased on the query, suggest which retrieval methods should be used (select one or more). 
  Order them according to their relevance to the query. 
  Respond with the method names only, separated by commas. 
  Select spatial search methods if the query is related to geospatial knowledge like "Chicago" or "Florida".
  If there is no suitable search result for the query or the user is not asking about a question about the geospatial knowledge, return a empty string.
  Only select 1 or 2 methods that are relevant to the query.
  Only select the methods that are listed and do not invent new methods.
  Do not include any explanations or additional text.
  Examples:
  Q: What are the most viewed datasets?
→ getNeo4jSearchResults

Q: Recommend related publications to this notebook.
→ getNeo4jSearchResults

Q: What is the flood map for Chicago?
→ getSemanticSearchResults

Q: Climate change datasets
→ getKeywordSearchResults

Q: Anything near Colorado?
→ getSpatialSearchResults
`;

  return prompt;
}

// Load the function implementations into a mapping object
const functionMapping = {
  getNeo4jSearchResults,
  getKeywordSearchResults,
  getSemanticSearchResults,
  getSpatialSearchResults,
};

// Route the user query dynamically based on LLM's selection
async function routeUserQuery(userQuery) {
  try {
    // Load the search methods descriptions from the CSV
    const searchMethods = await loadSearchMethods();

    // Generate the prompt for the LLM based on user query
    const routingPrompt = await generateRoutingPrompt(userQuery, searchMethods);

    // Call LLM to decide which methods to use
    //const queryPayload = createQueryPayload("llama3.2:latest", "You are a routing agent for search methods.", routingPrompt);
    //const result = await callLlamaModel(queryPayload);
    let result;
    // Call the LLM to get the response
    if(process.env.USE_GPT==true){
      const queryPayload = createQueryPayload(
        "gpt-4o",
        "You are a routing agent for search methods",
        routingPrompt
      );
      result = await callGPTModel(queryPayload);
    }else{
      const queryPayload = createQueryPayload("llama3.2:latest", "You are a routing agent for search methods.", routingPrompt, 0.2, 1.0);
      result = await callLlamaModel(queryPayload);
    }

    // Parse LLM's response and extract selected methods
    //const selectedMethods = result?.message?.content?.trim();
    const selectedMethods = result;
    if (!selectedMethods || selectedMethods[0] === 'noSearch') {
      throw new Error('No methods selected by LLM： ' + selectedMethods);
    } else {
      console.log('Selected methods:', selectedMethods);
    }

    // Split the selected methods and dynamically call the corresponding functions
    const methodsToCall = selectedMethods.split(',').map((method) => method.trim());

    const results = [];
    for (const methodName of methodsToCall) {
      if (functionMapping[methodName]) {
        console.log(`Calling method: ${methodName}`);
        console.assert(typeof functionMapping[methodName] === 'function', `Function ${methodName} is not a function!`);
        // Dynamically invoke the function based on method name
        const methodResults = await functionMapping[methodName](userQuery);
        console.log(`Method ${methodName} returned ${methodResults.length} results`);
        results.push(...methodResults);
      }
    }
    // Remove duplicates based on _id
    const uniqueResults = Array.from(
      new Map(results.map(item => [item._id, item])).values()
    );

    return uniqueResults;

  } catch (error) {
    console.error('Error routing user query:', error);
    return [];
  }
}

export { routeUserQuery };