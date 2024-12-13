import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { getOrCreateMemory, updateMemory, deleteMemory } from './rag_modules/memory_modules';
import { getSemanticSearchResults } from './rag_modules/search_modules';
import { gradeDocuments, gradeGenerationVsDocumentsAndQuestion } from './rag_modules/grader_modules';
import { callLlamaModel } from './rag_modules/llm_modules';

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
async function gradeDocuments(documents, question) {
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
}

// Helper: Format documents for Llama model prompt
function formatDocs(docs) {
  return docs
    .map(doc => `title: ${doc._source.title}\ncontent: ${doc._source.contents}\ncontributor: ${doc._source.contributor}`)
    .join("\n\n");
}

// Function: Generate an answer using relevant documents
async function generateAnswer(state) {
  console.log("---GENERATE---");
  const { question, documents, loop_step = 0 } = state;

  const docsTxt = formatDocs(documents);
  const generationPrompt = `User Query: ${question}\nSearch Results:\n${docsTxt}`;

  const llmResponse = await callLlamaModel(
    createQueryPayload("llama3.2:latest", "You are an assistant summarizing search results.", generationPrompt)
  );

  return {
    documents,
    generation: llmResponse?.message?.content || "No response from LLM.",
    question,
    loop_step: loop_step + 1,
  };
}


// Function: Handle a user query
async function handleUserQuery(userQuery, checkGenerationQuality) {
  console.log("Fetching search results...");
  const searchResults = await getSemanticSearchResults(userQuery);

  let relevantDocuments = [];
  if (searchResults && searchResults.length > 0) {
    console.log("Grading documents...");
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
      if (verdict === "not supported" || verdict === "not useful") {
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
router.options('/llm/memory-id', cors());
router.post('/llm/memory-id', cors(), async (req, res) => {
    const conversationName = `conversation-${uuidv4()}`; // Generate random conversation name

    try {
        const memoryId = await createMemory(conversationName);
        res.json({ memoryId, conversationName });
    } catch (error) {
        res.status(500).json({ error: 'Error creating memory' });
    }
});

/**
 * @swagger
 * /beta/llm/search:
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
router.options('/llm/search', cors());
router.post('/llm/search', cors(), async (req, res) => {
  const { userQuery } = req.body;

  if (!userQuery) {
    return res.status(400).json({ error: "Missing userQuery in request body." });
  }

  try {
    const response = await handleUserQuery(userQuery, false);
    if (response.error) {
      return res.status(500).json({ error: response.error });
    }
    res.status(200).json(response);
  } catch (error) {
    console.error("Error performing conversational search:", error);
    res.status(500).json({ error: "Error performing conversational search." });
  }
});

export default router;
