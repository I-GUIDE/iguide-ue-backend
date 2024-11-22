import fetch from 'node-fetch';
import readline from 'readline';
import { Client } from '@opensearch-project/opensearch';
import dotenv from 'dotenv';
dotenv.config();

// initialize opensearch client with authentication
const client = new Client({
  node: process.env.OPENSEARCH_NODE,
  auth: {
    username: process.env.OPENSEARCH_USERNAME,
    password: process.env.OPENSEARCH_PASSWORD,
  },
  ssl: { rejectUnauthorized: false },
});

// function to create query payload for llama model
function createQueryPayload(model, systemMessage, userMessage, stream) {
  return {
    model,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
    stream,
  };
}

// send request to llama model with payload
async function callLlamaModel(queryPayload) {
  const llamaApiUrl = process.env.ANVILGPT_URL;;
  const anvilGptApiKey = process.env.ANVILGPT_KEY;

  try {
    const response = await fetch(llamaApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anvilGptApiKey}`, // include api key
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(queryPayload),
    });

    if (response.ok) return await response.json(); // return json if response is ok
    const errorText = await response.text(); // log detailed error if request fails
    throw new Error(`Error: ${response.status}, ${errorText}`);
  } catch (error) {
    console.error("Error fetching from Llama model:", error);
    return null;
  }
}

// search opensearch index for user query
async function getSearchResults(userQuery) {
  try {
    const response = await client.search({
      index: process.env.OPENSEARCH_INDEX,
      body: { query: { match: { contents: userQuery } } },
    });
    return response.body.hits.hits; // return search results
  } catch (error) {
    console.error("Error connecting to OpenSearch:", error);
    return [];
  }
}

// evaluate relevance of documents to user question
async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  for (const doc of documents) {
    const graderPrompt = `
      here is the retrieved document: \n\n ${doc} \n\n here is the user question: \n\n ${question}.
      carefully and objectively assess whether the document contains at least some information that is relevant to the question.
      return only json with a single key, binary_score, that is 'yes' or 'no'.
    `;

    const queryPayload = createQueryPayload(
      "llama3.2:latest",
      "you are a grader assessing relevance of retrieved documents to a user question.",
      graderPrompt,
      false
    );

    const result = await callLlamaModel(queryPayload);

    // if result is "yes", document is relevant
    if (result?.message?.content?.toLowerCase().includes('"binary_score": "yes"')) {
      console.log("---GRADE: DOCUMENT RELEVANT---");
      gradedDocuments.push(doc);
    } else {
      console.log("---GRADE: DOCUMENT NOT RELEVANT---");
    }
  }

  return gradedDocuments; // return graded documents
}

// main pipeline to handle user input
async function handleUserInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const getUserInput = () =>
    new Promise((resolve) => rl.question('Enter the user query (or type "exit" to quit): ', resolve));

  while (true) {
    const userQuery = await getUserInput();

    if (userQuery.toLowerCase() === 'exit') {
      console.log('Exiting...');
      rl.close();
      break;
    }

    console.log("fetching search results...");
    const searchResults = await getSearchResults(userQuery);

    if (!searchResults || searchResults.length === 0) {
      console.log("no search results found.");
      continue;
    }

    // format search results for llama model
    const formattedResults = searchResults.map(
      (hit) =>
        `title: ${hit._source.title}\ncontent: ${hit._source.contents}\ncontributor: ${hit._source.contributor}`
    );

    console.log("calling llama model for summary...");
    const queryPayload = createQueryPayload(
      "llama",
      "you are an assistant who helps summarize and organize information from search results.",
      `user query: ${userQuery}\nsearch results:\n${formattedResults.join("\n\n")}`,
      false
    );
    console.log("payload sent to llama model:", JSON.stringify(queryPayload, null, 2));
    const llamaResponse = await callLlamaModel(queryPayload);

    if (llamaResponse && llamaResponse.message && llamaResponse.message.content) {
      console.log("\nllama model response:");
      console.log(llamaResponse.message.content);
    } else {
      console.log("unexpected response format or no choices available.");
    }

    // grade documents for relevance
    console.log("Grading documents...");
    const gradedDocuments = await gradeDocuments(formattedResults, userQuery);

    console.log("\ngraded documents:");
    gradedDocuments.forEach((doc, index) => {
      console.log(`document ${index + 1}:\n${doc}\n`);
    });
  }
}

handleUserInput();
