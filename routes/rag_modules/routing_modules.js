import { callLlamaModel, createQueryPayload, callGPTModel } from './llm_modules.js';
import { getKeywordSearchResults, getSemanticSearchResults, getNeo4jSearchResults, getOpenSearchAgentResults} from './search_modules.js';
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

  prompt += `
First, reason step by step about which search methods are most appropriate for this query and why. 
Then, on a new line, output the method names only, separated by "Methods:".
Do not include any explanations or additional text after the methods line.

Examples:
Q: What are the most viewed datasets?
Reasoning: The query asks for the most viewed datasets, which is tracked in Neo4j.
Methods: getNeo4jSearchResults

Q: What is the challenge in computational Agent-Based Models?
Reasoning: The query is about a research challenge, so semantic and keyword search are relevant.
Methods: getSemanticSearchResults, getKeywordSearchResults

Q: What is the flood map for Chicago?
Reasoning: The query is about a map for a location, so semantic and spatial search are relevant.
Methods: getSemanticSearchResults, getOpenSearchAgentResults

Q: Climate change datasets
Reasoning: The query is a general topic, so keyword search is appropriate.
Methods: getKeywordSearchResults

Q: Anything near Colorado?
Reasoning: The query is about proximity to a location, so spatial search is relevant.
Methods: getOpenSearchAgentResults
`;

  return prompt;
}

// Load the function implementations into a mapping object
const functionMapping = {
  getNeo4jSearchResults,
  getKeywordSearchResults,
  getSemanticSearchResults,
  getSpatialSearchResults,
  getOpenSearchAgentResults,
};

// Route the user query dynamically based on LLM's selection
async function routeUserQuery(userQuery) {
  try {
    console.log("Routing user query:", userQuery);
    // 1. Keyword-based routing overrides
    const uq = userQuery.toLowerCase();
    if (/(most viewed|top clicked|most popular)/.test(uq)) {
      console.log("Routing to Neo4j for query:", userQuery);
      return getNeo4jSearchResults(userQuery);
    }
    if (/(\\bnear\\b|latitude|longitude|bounding box)/.test(uq)) {
      console.log("Routing to Spatial search for query:", userQuery);
      return getSpatialSearchResults(userQuery);
    }

    // 2. Otherwise, use LLM to reason and decide
    const searchMethods = await loadSearchMethods();
    const routingPrompt = await generateRoutingPrompt(userQuery, searchMethods);

    let result;
    if(process.env.USE_GPT=="true"){
      const queryPayload = createQueryPayload(
        "gpt-4o",
        "You are a routing agent for search methods",
        routingPrompt
      );
      result = await callGPTModel(queryPayload);
    }else{
      const queryPayload = createQueryPayload("qwen2.5:7b-instruct", "You are a routing agent for search methods.", routingPrompt, 0.2, 1.0);
      result = await callLlamaModel(queryPayload);
    }

    // Parse LLM's response for reasoning and methods
    let llmContent = result?.message?.content || result?.content || result;
    let reasoning = '';
    let selectedMethods = '';
    if (typeof llmContent === 'string') {
      const lines = llmContent.trim().split('\n');
      const reasoningLine = lines.find(line => line.toLowerCase().startsWith('reasoning:'));
      reasoning = reasoningLine ? reasoningLine.replace(/^reasoning:\s*/i, '') : '';
      const methodsLine = lines.find(line => line.toLowerCase().startsWith('methods:'));
      selectedMethods = methodsLine ? methodsLine.replace(/^methods:\s*/i, '') : '';
    }

    if (!selectedMethods) {
      throw new Error('No methods selected by LLM: ' + selectedMethods);
    } else {
      console.log('Routing reasoning:', reasoning);
      console.log('Selected methods:', selectedMethods);
    }

    // Split the selected methods and dynamically call the corresponding functions
    const methodsToCall = selectedMethods.split(',').map((method) => method.trim());

    const results = [];
    for (const methodName of methodsToCall) {
      if (functionMapping[methodName]) {
        console.log(`Calling method: ${methodName}`);
        const methodResults = await functionMapping[methodName](userQuery);
        console.log(`Method ${methodName} returned ${methodResults.length} results`);
        results.push(...methodResults);
      }
    }
    // Remove duplicates based on _id
    const uniqueResults = Array.from(
      new Map(results.map(item => [item._id, item])).values()
    );

    // Optionally, return reasoning with results
    // return { results: uniqueResults, reasoning };
    return uniqueResults;

  } catch (error) {
    console.error('Error routing user query:', error);
    return [];
  }
}

export { routeUserQuery };