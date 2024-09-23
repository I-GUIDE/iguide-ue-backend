import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import session from 'express-session';
import { v4 as uuidv4 } from 'uuid';

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

// Function to create memory in OpenSearch
async function createMemory(conversationName) {
    try {
        const response = await client.transport.request({
            method: 'POST',
            path: '/_plugins/_ml/memory/',
            body: {
                name: conversationName
            }
        });
        return response.body.memory_id;
    } catch (error) {
        console.error('Error creating memory:', error);
        throw error;
    }
}

// Function to perform search with memory in OpenSearch
async function performSearchWithMemory(userQuery, memoryId) {
    try {
        const searchResponse = await client.search({
            index: process.env.OPENSEARCH_INDEX,
            search_pipeline: 'rag_pipeline', //Specify the optional search pipeline
            body: {
                query: {
                    multi_match: {
                        query: userQuery,
                        fields: ["authors", "tags", "contents", "title", "contributors"],
                        type: "best_fields" // "best_fields" selects the most relevant field for matching.
                    }
                },
                ext: {
                    generative_qa_parameters: {
                        llm_model: "gpt-3.5-turbo", 
                        llm_question: userQuery,
                        memory_id: memoryId, // Pass the memory ID here
                        context_size: 5,
                        message_size: 5,
                        timeout: 15
                    }
                }
            }
        });
        return searchResponse.body;
    } catch (error) {
        console.error('Error performing search with memory:', error);
        throw error;
    }
}

// New endpoint to create a memory ID with a random conversation name
router.options('/create-llm-memory', cors());
router.post('/create-llm-memory', cors(), async (req, res) => {
    const conversationName = `conversation-${uuidv4()}`; // Generate random conversation name

    try {
        const memoryId = await createMemory(conversationName);
        res.json({ memoryId, conversationName });
    } catch (error) {
        res.status(500).json({ error: 'Error creating memory' });
    }
});

// Modified /llm-search to take memoryId as an optional parameter
router.options('/llm-search', cors());
router.post('/llm-search', cors(), async (req, res) => {
    const { userQuery, memoryId } = req.body;

    try {
        let finalMemoryId = memoryId;

        // If no memoryId is provided, create a new memory
        if (!finalMemoryId) {
            console.log("No memoryId provided, creating a new memory...");
            finalMemoryId = await createMemory(userQuery);
        }

        console.log(`Searching "${userQuery}" with memoryID: ${finalMemoryId}`); 

        // Perform the search with the provided or newly created memory ID
        const searchResponse = await performSearchWithMemory(userQuery, finalMemoryId);

        res.json(searchResponse);
    } catch (error) {
        console.error('Error performing conversational search:', error);
        res.status(500).json({ error: 'Error performing conversational search' });
    }
});
export default router;
