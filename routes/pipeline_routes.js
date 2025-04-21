import express, { raw } from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { formComprehensiveUserQuery, getOrCreateMemory, updateMemory, deleteMemory, createMemory } from './rag_modules/memory_modules.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import { authenticateJWT, authorizeRole, generateAccessToken } from '../jwtUtils.js';
import { getSemanticSearchResults } from './rag_modules/search_modules.js';
import { gradeDocuments, gradeGenerationVsDocumentsAndQuestion } from './rag_modules/grader_modules.js';
import { callGPTModel, callLlamaModel } from './rag_modules/llm_modules.js';
import { routeUserQuery } from './rag_modules/routing_modules.js';
import * as utils from '../utils.js';
import { extractJsonFromLLMReturn, formatDocsJson} from './rag_modules/rag_utils.js';
import { generateAnswer } from './rag_modules/generation_module.js';
import { restrictToUIUC } from '../ip_policy.js';
import {createQueryPayload} from './rag_modules/llm_modules.js';
const router = express.Router();

// Initialize OpenSearch client
const client = new Client({
  node: process.env.OPENSEARCH_NODE,
  auth: {
    username: process.env.OPENSEARCH_USERNAME,
    password: process.env.OPENSEARCH_PASSWORD,
  },
  ssl: {
    rejectUnauthorized: false,
  },
});







// Function: Grade documents for relevance
/*async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  for (const doc of documents) {
    const graderPrompt = `
      Here is the retrieved document: \n\n ${doc._source.contents} \n\n Here is the user question: \n\n ${question}.
      Carefully assess whether the document contains relevant information.
      Return JSON with a single key, binary_score, with value 'yes' or 'no'.
    `;

    const queryPayload = createQueryPayload(
      "llama3.2:latest",
      "You are a grader assessing the relevance of retrieved documents to a user question.",
      graderPrompt
    );

    const result = await callLlamaModel(queryPayload);

    if (result?.message?.content?.toLowerCase().includes('"binary_score": "yes"')) {
      console.log("---GRADE: DOCUMENT RELEVANT---");
      gradedDocuments.push(doc);
    } else {
      console.log("---GRADE: DOCUMENT NOT RELEVANT---");
    }
  }

  return gradedDocuments;
}*/






// Function: Handle a user query
async function handleUserQuery(userQuery, comprehensiveUserQuery, checkGenerationQuality) {
  console.log("Fetching search results");
  const searchResults = await routeUserQuery(comprehensiveUserQuery);

  let relevantDocuments = [];
  if (searchResults && searchResults.length > 0) {
    console.log("Grading " + searchResults.length + " documents");
    relevantDocuments = await gradeDocuments(searchResults, userQuery);
  }

  if (relevantDocuments.length === 0) {
    console.log("No relevant documents found.");
    return {
      answer: "Sorry, I couldn't find any relevant documents for your query.",
      message_id: uuidv4(),
      elements: [],
      count: 0,
    };
  }

  let state = { question: userQuery, documents: relevantDocuments };
  let generationState = await generateAnswer(state);

  console.log("\nGenerated Answer:", generationState.generation);

  if (checkGenerationQuality) {
    let verdict = await gradeGenerationVsDocumentsAndQuestion(generationState);
    while (verdict !== "useful") {
      if (verdict === "not useful") {
        generationState = await generateAnswer(generationState);
        verdict = await gradeGenerationVsDocumentsAndQuestion(generationState);
      } else if (verdict === "max retries") {
        console.log("Unable to get a satisfactory answer.");
        return {
          answer: "I'm sorry, I couldn't generate a satisfactory answer at the moment. Please try rephrasing your question.",
          message_id: uuidv4(),
          elements: [],
          count: 0,
        };
      }
    }
  }

  return {
    answer: generationState.generation || "I'm sorry, I couldn't generate a satisfactory answer at the moment.",
    message_id: uuidv4(),
    elements: relevantDocuments.map(doc => ({
      _id: doc._id,
      _score: doc._score,
      contributor: doc._source.contributor,
      contents: doc._source.contents,
      "resource-type": doc._source["resource-type"],
      title: doc._source.title,
      authors: doc._source.authors || [],
      tags: doc._source.tags || [],
      "thumbnail-image": doc._source["thumbnail-image"],
    })),
    count: relevantDocuments.length,
  };
}
export async function handleIterativeQuery(
  userQuery,
  comprehensiveUserQuery,
  checkGenerationQuality,
  progressCallback = () => {}
) {
  // 1) Initialization
  progressCallback(`Starting iterative retrieval for: "${comprehensiveUserQuery}"`);
  console.log("Starting iterative retrieval for", comprehensiveUserQuery);

  // We'll store all relevant documents gathered across multiple LLM requests
  let relevantDocuments = [];
  // We'll also store each retrieval step: { searchQuery, results: [...] }
  const retrievalSteps = [];

  let iterationCount = 0;
  const MAX_ITERATIONS = 5;

  let finalAction = null;
  let finalAnswerContent = "";

  // 2) Iteration loop
  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    progressCallback(`Iteration #${iterationCount}: Checking if we have enough info`);

    // Prompt the LLM with user query + current docs
    const iterationPrompt = buildIterativePrompt(userQuery, relevantDocuments, retrievalSteps);
    //console.log(`Iteration #${iterationCount}, Prompt:`, iterationPrompt);
    const systemPrompt = `You are a multistep *retrieval‑and‑reasoning* agent.

### Goal
Answer the user's question by chaining searches **only when truly necessary**.

### Sufficiency Test (Stop searching when BOTH are true)
1. You can answer every part of the user’s question.
2. Your answer is supported by at least one cited document in the context.

### Procedure for each iteration
1. **Think in the Scratchpad** about whether the Sufficiency Test is met.
2. If the test is met ➜ prepare a ONE‑sentence answer summary.
3. If the test is *not* met ➜ plan ONE new, more‑specific search query that uses newly discovered facts.
4. After the Scratchpad, output *only* valid JSON:
   • {"action":"answer","content":"<final answer>"}  
   • or  
   • {"action":"search","search_query":"<next query>"}

### Constraints
- Never propose a search that merely rephrases an earlier one.  
- Answer concisely; cite facts from the documents implicitly (no URLs needed).  
- The Scratchpad must never appear in the JSON.`;

    let llmResponse;
    // Call the LLM
    if(process.env.USE_GPT==true){
      llmResponse = await callGPTModel(
        createQueryPayload(
          "gpt-4o",
          systemPrompt,
          iterationPrompt
        )
      );
    }
    else{
      llmResponse = await callLlamaModel(
        createQueryPayload(
          "llama3:instruct",
          systemPrompt,
          iterationPrompt
        )
    );
  }

    //const rawContent = llmResponse;
    console.log("LLM Iteration Response:", llmResponse);

    // Attempt to parse JSON from the LLM response
    let parsedAction;
    try {
      console.log("Extracting JSON block from LLM response", llmResponse);
      parsedAction = extractJsonFromLLMReturn(llmResponse);
      console.log("Json from the response: ", parsedAction);
    } catch (err) {
      // If not valid JSON, treat entire text as final answer or break
      console.warn("LLM returned invalid JSON. Stopping iteration." ,err);
      finalAction = "answer";
      finalAnswerContent = llmResponse;
      break;
    }
    console.log("Parsed Action:", parsedAction);

    // 3) Check the action from the LLM
    if (parsedAction.action === "search") {
      // LLM wants more data: run search
      const searchQuery = parsedAction.search_query || "";
      progressCallback(`LLM requests more info via search: "${searchQuery}"`);

      const newResults = await routeUserQuery(searchQuery);

      // Optionally grade them if you want
      progressCallback(`Grading ${newResults.length} newly found documents`);
      const newlyRelevant = await gradeDocuments(newResults, userQuery);

      // (A) Record the retrieval step
      retrievalSteps.push({
        searchQuery,
        results: newlyRelevant
      });

      // (B) Merge newly relevant docs into our main set
      relevantDocuments.push(...newlyRelevant);
      try{
        const uniqueDocsMap = new Map();
        for (const doc of relevantDocuments) {
          uniqueDocsMap.set(doc._id, doc);
        }
        relevantDocuments = Array.from(uniqueDocsMap.values());
        relevantDocuments.sort((a, b) => b._score - a._score);
        relevantDocuments = relevantDocuments.slice(0, 10);
      }catch(err){
        console.error("Error while removing duplicates: ", err);
      }

    } else if (parsedAction.action === "answer") {
      // LLM says it has enough info
      finalAction = "answer";
      finalAnswerContent = parsedAction.content || "No content from LLM.";
      progressCallback("LLM indicates it has enough info to answer.");
      break;

    } else {
      // Unrecognized action => treat as final
      console.warn("LLM returned unrecognized action:", parsedAction.action);
      finalAction = "answer";
      finalAnswerContent = rawContent;
      break;
    }
  }

  // If we never got "answer", we'll still generate a final answer ourselves
  if (finalAction !== "answer") {
    progressCallback("Maximum iterations reached. Generating final answer anyway.");
  }

  // 4) Generate final answer from all relevant docs
  progressCallback("Generating final answer from all relevant documents");
  let state = {
    question: userQuery,
    augmentedQuery: comprehensiveUserQuery,
    documents: relevantDocuments,
  };

  let generationState = await generateAnswer(state);
  console.log("Generated Answer:", generationState.generation);

  // If you wish, you can replace or augment generationState.generation
  // with finalAnswerContent from the LLM's last iteration:
  // generationState.generation = finalAnswerContent;

  // 5) (Optional) Check generation quality
  if (checkGenerationQuality) {
    progressCallback("Validating answer quality");
    let verdict = await gradeGenerationVsDocumentsAndQuestion(generationState);
    let retryCount = 0;
    while (verdict !== "useful") {
      if (verdict === "not useful") {
        retryCount++;
        progressCallback(`Regenerating answer (attempt ${retryCount})`);
        generationState = await generateAnswer(generationState);
        verdict = await gradeGenerationVsDocumentsAndQuestion(generationState);
      } else if (verdict === "max retries") {
        progressCallback("Maximum retries reached - using best available answer");
        console.log("Unable to get a satisfactory answer.");
        return {
          answer: "I'm sorry, I couldn't generate a satisfactory answer at the moment. Please try rephrasing your question.",
          message_id: uuidv4(),
          elements: [],
          count: 0,
          retrievalSteps
        };
      }
    }
  }

  // 6) Return final result
  return {
    answer: generationState.generation || finalAnswerContent || "No final answer",
    message_id: uuidv4(),
    elements: relevantDocuments.map(doc => ({
      _id: doc._id,
      _score: doc._score,
      contributor: doc._source.contributor,
      contents: doc._source.contents,
      "resource-type": doc._source["resource-type"],
      title: doc._source.title,
      authors: doc._source.authors || [],
      tags: doc._source.tags || [],
      "thumbnail-image": doc._source["thumbnail-image"],
    })),
    count: relevantDocuments.length,
    retrievalSteps // Provide the array of search steps for context
  };
}
function buildIterativePrompt(userQuery, docsSoFar, retrievalSteps) {
  const stepsText = retrievalSteps.map((step, index) => {
    const docTitles = step.results
      .map((doc, i) => `(${i + 1}) ${doc._source.title || "Untitled"}`)
      .join(", ");
    return `Step #${index + 1} -> Searched: "${step.searchQuery}"
Found: ${docTitles}

`;
  }).join("");

  // Summarize or shorten large docs
  const docsText = docsSoFar.map((doc, i) => {
    const title = doc._source.title || "Untitled";
    // Provide a short excerpt of the doc contents (limit to ~200 characters)
    const snippet = doc._source.contents?.slice(0, 200) || "";
    return `Document #${i + 1}: "${title}"\nExcerpt: "${snippet}..."\n`;
  }).join("\n");

  return `
The user asked: "${userQuery}"

==================  Scratchpad  (free‑form thinking, NOT visible to user)  ==================
• First, restate in 1–2 clauses what the user wants.
• Second, list the *new* facts gleaned from the current documents.
• Third, decide: do these facts satisfy the Sufficiency Test?  If yes, draft a 1‑sentence answer;
  if no, draft ONE sharper search query that exploits the new facts.
================  END Scratchpad – the user never sees anything above  =====================

Now output ONLY one of the following JSON objects
• {"action":"answer","content":"<your one‑sentence answer>"}  
• {"action":"search","search_query":"<one next query>"}  

Previous Searches:
${stepsText}

Current Documents (summaries):
${docsText}

REMINDER: absolutely no extra keys or text outside the JSON.
`.trim();
}

async function handleUserQueryWithProgress(
  userQuery,
  comprehensiveUserQuery,
  checkGenerationQuality,
  progressCallback = () => {} // Add progress callback parameter
) {
  progressCallback("Fetching search results");
  console.log("Fetching search results for \"", comprehensiveUserQuery, "\"");
  const searchResults = await routeUserQuery(comprehensiveUserQuery);

  let relevantDocuments = [];
  if (searchResults && searchResults.length > 0) {
    progressCallback(`Grading ${searchResults.length} search results`);
    console.log("Grading " + searchResults.length + " search results");
    relevantDocuments = await gradeDocuments(searchResults, userQuery);
  }

  if (relevantDocuments.length === 0) {
    progressCallback("No relevant knowledge element found");
    console.log("No relevant knowledge element found.");
    return {
      answer: "Sorry, I couldn't find any relevant knowledge elelement for your question.",
      message_id: uuidv4(),
      elements: [],
      count: 0,
    };
  }

  let state = { question: userQuery, augmentedQuery: comprehensiveUserQuery, documents: relevantDocuments };
  
  progressCallback("Generating answer");
  let generationState = await generateAnswer(state);
  console.log("\nGenerated Answer:", generationState.generation);

  if (checkGenerationQuality) {
    progressCallback("Validating answer quality");
    let verdict = await gradeGenerationVsDocumentsAndQuestion(generationState);
    let retryCount = 0;
    
    while (verdict !== "useful") {
      if (verdict === "not useful") {
        retryCount++;
        progressCallback(`Regenerating answer (attempt ${retryCount})`);
        generationState = await generateAnswer(generationState);
        verdict = await gradeGenerationVsDocumentsAndQuestion(generationState);
      } else if (verdict === "max retries") {
        progressCallback("Maximum retries reached - using best available answer");
        console.log("Unable to get a satisfactory answer.");
        return {
          answer: "I'm sorry, I couldn't generate a satisfactory answer at the moment. Please try rephrasing your question.",
          message_id: uuidv4(),
          elements: [],
          count: 0,
        };
      }
    }
  }

  return {
    answer: generationState.generation || "I'm sorry, I couldn't generate a satisfactory answer at the moment.",
    message_id: uuidv4(),
    elements: relevantDocuments.map(doc => ({
      _id: doc._id,
      _score: doc._score,
      contributor: doc._source.contributor,
      contents: doc._source.contents,
      "resource-type": doc._source["resource-type"],
      title: doc._source.title,
      authors: doc._source.authors || [],
      tags: doc._source.tags || [],
      "thumbnail-image": doc._source["thumbnail-image"],
    })),
    count: relevantDocuments.length,
  };
}
/**
 * @swagger
 * /beta/llm/memory-id:
 *   post:
 *     summary: Create a new memory ID for LLM searches
 *     description: Generates a random memory ID with a conversation name for tracking search memory.
 *     tags:
 *       - Conversational Search
 *     responses:
 *       200:
 *         description: Successfully created a memory ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 memoryId:
 *                   type: string
 *                   description: The generated memory ID
 *                 conversationName:
 *                   type: string
 *                   description: The name of the conversation
 *       500:
 *         description: Error creating memory
 */
router.options('/llm/memory-id', jwtCorsMiddleware);
router.post('/llm/memory-id', jwtCorsMiddleware, authenticateJWT, authorizeRole(utils.Role.UNRESTRICTED_CONTRIBUTOR), async (req, res) => {
    const conversationName = `conversation-${uuidv4()}`; // Generate random conversation name

    try {
        const memoryId = await createMemory(conversationName);
        //const memoryId = uuidv4();
        res.json({ memoryId, conversationName });
    } catch (error) {
        res.status(500).json({ error: 'Error creating memory' });
    }
});

/**
 * @swagger
 * /beta/llm/legacy-search:
 *   post:
 *     summary: Perform a conversational search with memory
 *     description: Performs LLM-based search with optional memory tracking via OpenSearch.
 *     tags:
 *       - Conversational Search
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userQuery:
 *                 type: string
 *                 description: The query entered by the user for conversational search.
 *                 example: How is CyberGIS used in the researches
 *               memoryId:
 *                 type: string
 *                 description: The optional memory ID for the search. If not provided, a new memory will be created.
 *     responses:
 *       200:
 *         description: Successful search
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 took:
 *                   type: integer
 *                   description: Time taken for the search.
 *                 timed_out:
 *                   type: boolean
 *                   description: Whether the search timed out.
 *                 hits:
 *                   type: object
 *                   description: Search results.
 *                   properties:
 *                     total:
 *                       type: object
 *                       properties:
 *                         value:
 *                           type: integer
 *                           description: Total number of hits.
 *                     hits:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _source:
 *                             type: object
 *                             properties:
 *                               title:
 *                                 type: string
 *                                 description: Title of the knowledge element.
 *                               authors:
 *                                 type: array
 *                                 items:
 *                                   type: string
 *                                 description: Authors of the knowledge element.
 *                               tags:
 *                                 type: array
 *                                 items:
 *                                   type: string
 *                                 description: Tags associated with the knowledge element.
 *       500:
 *         description: Error performing conversational search
 */
router.options('/llm/legacy-search', cors());
router.post('/llm/legacy-search', cors(), async (req, res) => {
  const { userQuery, memoryId } = req.body;
  //var memoryId = "fakeid12345";
  if (!userQuery) {
    return res.status(400).json({ error: "Missing userQuery in request body." });
  }

  try {
    let finalMemoryId = memoryId;

    // If no memoryId is provided, create a new memory
    if (!finalMemoryId) {
      console.log("No memoryId provided, creating a new memory...");
      const conversationName = `conversation-${userQuery}-${uuidv4()}`;
      finalMemoryId = await createMemory(conversationName);
    }

    // Form a comprehensive user query
    const comprehensiveUserQuery = await formComprehensiveUserQuery(finalMemoryId, userQuery);

    console.log(`Searching "${comprehensiveUserQuery}" with memoryID: ${finalMemoryId}`);

    // Perform the search with the comprehensive user query and memory ID
    const response = await handleUserQuery(userQuery, comprehensiveUserQuery, true);
    if (response.error) {
      return res.status(500).json({ error: response.error });
    }

    // Update the chat history
    await updateMemory(finalMemoryId, userQuery, response.answer);
    res.status(200).json(response);
  } catch (error) {
    console.error("Error performing conversational search:", error);
    res.status(500).json({ error: "Error performing conversational search." });
  }
});
/**
 * @swagger
 * /beta/llm/search:
 *   post:
 *     summary: Perform LLM-based search with real-time progress updates via Server-Sent Events (SSE)
 *     description: |
 *       Accepts a user query and an optional memory ID to perform a comprehensive LLM-driven search.
 *       The response is streamed using Server-Sent Events (SSE), sending progress updates and the final result.
 *     consumes:
 *       - application/json
 *     produces:
 *       - text/event-stream
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userQuery:
 *                 type: string
 *                 description: The user's search query.
 *               memoryId:
 *                 type: string
 *                 description: (Optional) The memory ID used for context augmentation.
 *     responses:
 *       200:
 *         description: Stream of progress updates and final result using SSE.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 event: status
 *                 data: {"status":"Augmenting question..."}

 *                 event: result
 *                 data: {"answer":"..."}
 *       500:
 *         description: Server error occurred during search.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 event: error
 *                 data: {"error":"Internal server error"}
 */
// OPTIONS handler for CORS preflight (only needed if you allow other methods like POST)
// router.options('/llm/search', (req, res) => {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
//   res.sendStatus(204); // No Content
// });

// // GET-based SSE endpoint
// router.get('/llm/search', async (req, res) => {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');

//   const sendEvent = (event, data) => {
//     res.write(`event: ${event}\n`);
//     res.write(`data: ${JSON.stringify(data)}\n\n`);
//   };

//   try {
//     const userQuery = req.query.userQuery;
//     const memoryId = req.query.memoryId;
//     console.log("Received userQuery:", userQuery, "with memoryId:", memoryId);
//     if (!userQuery) {
//       sendEvent('error', { error: 'Missing userQuery in request query.' });
//       res.end();
//       return;
//     }

//     sendEvent('status', { status: 'Augmenting question...' });
//     const comprehensiveQuery = await formComprehensiveUserQuery(memoryId, userQuery);
//     if (!comprehensiveQuery) {
//       sendEvent('error', { error: 'Error: No memory found for the session!' });
//       res.end();
//       return;
//     }
//     const response = await handleUserQueryWithProgress(userQuery, comprehensiveQuery, false, (progress) => {
//       sendEvent('status', { status: progress });
//     });
//     if (Array.isArray(response.elements)) {
//       response.elements = response.elements.map((el) => {
//         const newEl = { ...el };
//         if (newEl._source && newEl._source["contents-embedding"]) {
//           delete newEl._source["contents-embedding"];
//         }
//         return newEl;
//       });
//     }
//     await updateMemory(memoryId, userQuery, response.answer);
//     sendEvent('status', { status: 'Updatting memory...' });
//     console.log("Updating memory with id ", memoryId);
//     sendEvent('result', response);
//     res.end();
//   } catch (err) {
//     sendEvent('error', { error: err.message });
//     res.end();
//   }
// });

// Allow POST preflight requests
const allowedOrigins = process.env.ALLOWED_DOMAIN_LIST ? JSON.parse(process.env.ALLOWED_DOMAIN_LIST) : [`${process.env.FRONTEND_DOMAIN}`]
router.options('/llm/search', (req, res) => {
  if (allowedOrigins.length > 1) {
      const origin = req.headers.origin;
      if (!origin || allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
      } else {
          res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
      }
  } else {
      res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204); // No Content
});

// POST-based SSE endpoint
router.post('/llm/search', async (req, res) => {
  res.header('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
  if (allowedOrigins.length > 1) {
      const origin = req.headers.origin;
      if (!origin || allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
      } else {
          res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
      }
  } else {
      res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const {user_id, user_role} = (() => {
    if (!req.user || req.user == null || typeof req.user === 'undefined'){
        return {user_id:null, user_role:null};
    }
    return {user_id:req.user.id, user_role:req.user.role}
  })();
  if(!(user_role <= utils.Role.UNRESTRICTED_CONTRIBUTOR)) {
      console.log(user_id, " blocked from accessing I-GUIDE AI");
      return res.status(403).json({ message: 'Forbidden: You do not have permission to access I-GUIDE AI.' });
  }
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { userQuery, memoryId } = req.body;
    //console.log("Headers received:", req.headers);
    //console.log("Received userQuery:", userQuery, "with memoryId:", memoryId);

    if (!userQuery) {
      sendEvent('error', { error: 'Missing userQuery in request body.' });
      res.end();
      return;
    }

    sendEvent('status', { status: 'Augmenting question' });
    const comprehensiveQuery = await formComprehensiveUserQuery(memoryId, userQuery);
    
    if (!comprehensiveQuery) {
      sendEvent('error', { error: 'Error: No memory found for the session!' });
      res.end();
      return;
    }
    let response = null;
    if(process.env.MULTIHOP_RAG==true){
      sendEvent('status', { status: 'Iterative retrieval' });
      console.log("Iterative retrieval for", comprehensiveQuery);
      response = await handleIterativeQuery(userQuery, comprehensiveQuery, false, (progress) => {
        sendEvent('status', { status: progress });
      });
    }else{
      response = await handleUserQueryWithProgress(userQuery, comprehensiveQuery, false, (progress) => {
        sendEvent('status', { status: progress });
      });
    }
    

    if (Array.isArray(response.elements)) {
      response.elements = response.elements.map((el) => {
        const newEl = { ...el };
        if (newEl._source && newEl._source["contents-embedding"]) {
          delete newEl._source["contents-embedding"];
        }
        return newEl;
      });
    }

    sendEvent('status', { status: 'Updating memory...' });
    await updateMemory(memoryId, userQuery, response.answer);
    console.log("Updated memory with id ", memoryId);

    sendEvent('result', response);
    res.end();
  } catch (err) {
    sendEvent('error', { error: err.message });
    res.end();
  }
});



export default router;