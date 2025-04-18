import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
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
            search_pipeline: 'rag_pipeline_local', //Specify the optional search pipeline
            body: {
                query: {
                    multi_match: {
                        query: userQuery,
                        fields: ["authors^2", "contents", "title^3", "contributors^2"],
                        type: "best_fields" // "best_fields" selects the most relevant field for matching.
                    }
                },
                ext: {
                    generative_qa_parameters: {
                        llm_model: "llama3:instruct", 
                        llm_question: userQuery,
                        memory_id: memoryId
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
        // handle no hits
        const scoreThreshold = 5.0;  // Adjust the threshold as needed
        const hits = searchResponse.hits.hits
            .filter(hit => hit._score >= scoreThreshold)  // Filter by score
            .map(hit => ({
                _id: hit._id,  // Include the _id field
                _score: hit._score, // Include score for relevance information
                ...hit._source // Include the _source fields
            }));
	    console.log(hits)
        //const hits = searchResponse.hits.hits || [];
        //const totalHits = searchResponse.hits.total.value || 0;

        // Limit the number of elements to at most 10 and handle null fields
        const elements = hits.slice(0, 10).map(hit => {
            const source = hit;
            return {
                ...source,
                tags: source.tags === undefined || source.tags === null ? null : source.tags, // Set to null if undefined or null
                authors: source.authors || null,  // Similar handling for other fields
                contents: source.contents || null,  // Ensuring null for missing contents
                title: source.title || null,  // Ensuring null for missing title
                contributor: source.contributor || null  // Ensuring null for missing contributor
            };
        });

        // Format the response
        const formattedResponse = {
            answer: searchResponse.ext.retrieval_augmented_generation?.answer || null, // Handle missing answer gracefully
            message_id: searchResponse.ext.retrieval_augmented_generation?.message_id || null, // Handle missing message ID gracefully
            elements: elements.length > 0 ? elements : [], // Return empty array if no elements
            count: elements.length // Return the total number of hits
        };

        // Send the formatted response to the user
        res.json(formattedResponse);
    } catch (error) {
        console.error('Error performing conversational search:', error);
        res.status(500).json({ error: 'Error performing conversational search' });
    }
});

export default router;
