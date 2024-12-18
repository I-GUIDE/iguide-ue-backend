import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { LangGraph } from 'langgraph'; // Import LangGraph

const router = express.Router();
const langgraph = new LangGraph({
  apiKey: process.env.LANGGRAPH_API_KEY, // LangGraph API key from .env
});

// Define LangGraph workflows
const createConversationalSearchWorkflow = async (userQuery, memoryId = null) => {
  return langgraph.createWorkflow({
    name: `Conversational Search - ${uuidv4()}`,
    description: 'Search for knowledge and generate conversational answers.',
    steps: [
      {
        id: 'search-documents',
        type: 'search', // Native search capability in LangGraph
        params: {
          query: userQuery,
          embeddingModel: process.env.LANGGRAPH_EMBEDDING_MODEL,
          searchIndex: process.env.OPENSEARCH_INDEX,
          maxResults: 15,
        },
      },
      {
        id: 'grade-documents',
        type: 'llm-task',
        params: {
          model: process.env.LANGGRAPH_LLM_MODEL,
          promptTemplate: `
            You are grading the relevance of documents to a user query.
            Query: {{inputs.query}}
            Document: {{inputs.document}}
            Return JSON: { "binary_score": "yes" or "no" }
          `,
        },
        inputs: {
          query: userQuery,
          documents: '@search-documents.results',
        },
        filters: {
          keepIf: 'binary_score === "yes"',
        },
      },
      {
        id: 'generate-answer',
        type: 'llm-task',
        params: {
          model: process.env.LANGGRAPH_LLM_MODEL,
          promptTemplate: `
            Summarize the following relevant documents to answer the user's question.
            Question: {{inputs.query}}
            Relevant Documents: {{inputs.documents}}
          `,
        },
        inputs: {
          query: userQuery,
          documents: '@grade-documents.results',
        },
      },
      {
        id: 'grade-answer',
        type: 'llm-task',
        params: {
          model: process.env.LANGGRAPH_LLM_MODEL,
          promptTemplate: `
            Grade the following answer for factual accuracy and relevance:
            Facts: {{inputs.documents}}
            Answer: {{inputs.answer}}
            Question: {{inputs.query}}
            Return JSON: { "binary_score": "yes" or "no", "explanation": "..." }
          `,
        },
        inputs: {
          documents: '@grade-documents.results',
          answer: '@generate-answer.result',
          query: userQuery,
        },
      },
    ],
    memory: memoryId ? { id: memoryId } : undefined, // Optional memory for conversation
  });
};

// Endpoint: Create memory ID
router.options('/llm/memory-id', cors());
router.post('/llm/memory-id', cors(), async (req, res) => {
  try {
    const memory = await langgraph.createMemory({
      name: `conversation-${uuidv4()}`,
    });
    res.status(200).json({ memoryId: memory.id, conversationName: memory.name });
  } catch (error) {
    console.error('Error creating memory:', error);
    res.status(500).json({ error: 'Error creating memory' });
  }
});

// Endpoint: Perform conversational search
router.options('/llm/search', cors());
router.post('/llm/search', cors(), async (req, res) => {
  const { userQuery, memoryId } = req.body;

  if (!userQuery) {
    return res.status(400).json({ error: 'Missing userQuery in request body.' });
  }

  try {
    const workflow = await createConversationalSearchWorkflow(userQuery, memoryId);
    const result = await langgraph.runWorkflow(workflow.id);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    const { outputs } = result;
    res.status(200).json({
      answer: outputs['generate-answer'].result,
      gradedAnswer: outputs['grade-answer'].result,
      relevantDocuments: outputs['grade-documents'].results,
    });
  } catch (error) {
    console.error('Error performing conversational search:', error);
    res.status(500).json({ error: 'Error performing conversational search.' });
  }
});

export default router;
