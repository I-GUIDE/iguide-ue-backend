import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { formComprehensiveUserQuery, getOrCreateMemory, updateMemory, deleteMemory, createMemory } from './rag_modules/memory_modules.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import { authenticateJWT, authorizeRole, generateAccessToken } from '../jwtUtils.js';
import { getSemanticSearchResults } from './rag_modules/search_modules.js';
import { gradeDocuments, gradeGenerationVsDocumentsAndQuestion } from './rag_modules/grader_modules.js';
import { callLlamaModel } from './rag_modules/llm_modules.js';
import { routeUserQuery } from './rag_modules/routing_modules.js';
import * as utils from '../utils.js';

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

// Helper: Create query payload for Llama model
function createQueryPayload(model, systemMessage, userMessage, stream = false) {
  return {
    model,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
    stream,
  };
}




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

// Helper: Format documents for Llama model prompt
function formatDocs(docs) {
  return docs
    .map(doc => `title: ${doc._source.title}\ncontributor: ${doc._source.contributor}\nauthors: ${doc._source.authors}\ncontent: ${doc._source.contents}\ntags:${doc._source.tags}`)
    .join("\n\n");
}

// Function: Generate an answer using relevant documents
async function generateAnswer(state, temperature = 0.7, top_p = 0.9) {
  console.log("---GENERATE---");
  const { question, augmentedQuery, documents, loop_step = 0 } = state;

  const docsTxt = formatDocs(documents);
  const systemPrompt = `You are an authoritative expert answering questions based on supporing information from that you assume are given by yourself. Follow these rules:
  1. Use ONLY the provided research results to craft a direct, actionable answer to the user's query.
  2. NEVER mention "documents," "search results," or "data sources" – answer as if this is your own knowledge.
  3. If information is incomplete, say "I don't have enough information to fully answer this."
  4. Avoid phrases like "This text appears..." or "The datasets show..." – focus on delivering the answer itself.
  5. All the supporting information comes from your internal knowledge base."`;
  /*const fewShotExamples = `
Example 1:
User Query: What are the benefits of regular exercise?
Retrieved Information:
- Regular exercise improves cardiovascular health.
- It aids in weight management.
- Exercise enhances mental health by reducing stress and anxiety.

Answer: Regular exercise offers multiple benefits, including improved cardiovascular health, effective weight management, and enhanced mental well-being through stress and anxiety reduction.

Example 2:
User Query: Any of these related to social media?
Augmented Query: Chicago datasets related to social media
Retrieved Information:

Title: Social Media (Twitter) Data Visualization
Author: Fangzheng Lyu
Contents: Demonstrates visualization techniques for location-based Twitter data in Chicago and beyond.

Title: Mapping Dynamic Human Sentiments of Heat Exposure
Author: Fangzheng Lyu
Contents: Uses near real-time location-based Twitter data to analyze and visualize how Chicago residents discuss and respond to extreme heat.

Title: Twitter Data
Author: Fangzheng Lyu
Contents: Provides datasets associated with the “Mapping Dynamic Human Sentiments of Heat Exposure” study, focusing on geotagged tweets.

Title: National-level Analysis using Twitter Data
Author: Fangzheng Lyu
Contents: Offers a workflow for large-scale sentiment analysis of heat exposure using location-based Twitter data.

Title: Understanding Demographic and Socioeconomic Biases of Geotagged Twitter Users
Author: Ruowei Liu
Contents: Explores how demographic and socioeconomic factors affect Twitter usage patterns at the county level, including Chicago.

Answer: Several Chicago-specific datasets center on location-based Twitter data and provide insights into social media usage in urban contexts. For example, Fangzheng Lyu’s resources illustrate how to visualize geotagged tweets in the city, offering near real-time analysis of heat exposure and human sentiments. Ruowei Liu’s work further examines biases in geotagged Twitter usage, shedding light on the demographic and socioeconomic factors shaping online engagement across counties, including Chicago. You might explore more of Lyu’s or Liu’s publications—or reach out directly—to deepen your understanding of how social media data can inform urban research and decision-making.
`;*/
  const fewShotExamples = ``;
  console.log("Documents: ", docsTxt);
  const userPrompt = `${fewShotExamples}
  **Question**: ${question}
  **Augmented Query based on context **: ${augmentedQuery}
  **Supporting Information**:
  ${docsTxt}
  Answer the question while paying attention to the context as if this knowledge is inherent to you.`;
  
  const llmResponse = await callLlamaModel(
    createQueryPayload("llama3:instruct", systemPrompt, userPrompt, 
  )
  );

  return {
    documents,
    generation: llmResponse?.message?.content || "No response from LLM.",
    question,
    loop_step: loop_step + 1,
  };
}



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

    const response = await handleUserQueryWithProgress(userQuery, comprehensiveQuery, false, (progress) => {
      sendEvent('status', { status: progress });
    });

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