import axios from 'axios';
import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate Limiter Configuration
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    headers: true,
});

// Apply rate limiter to all requests
router.use(limiter);

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
                name: conversationName,
            },
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
            search_pipeline: 'rag_pipeline_local',
            body: {
                query: {
                    multi_match: {
                        query: userQuery,
                        fields: ["authors^2", "contents", "title^3", "contributors^2"],
                        type: "best_fields",
                    },
                },
                ext: {
                    generative_qa_parameters: {
                        llm_model: "llama3:latest",
                        llm_question: userQuery,
                        memory_id: memoryId,
                    },
                },
            },
        });
        return searchResponse.body;
    } catch (error) {
        console.error('Error performing search with memory:', error);
        throw error;
    }
}

// Function to call GPT API for filtering
async function filterElementsWithGPT(userQuery, answer, elements) {
    try {
        const prompt = `
        Generated Answer: ${answer}
        Elements: ${JSON.stringify(elements)}

        Based on the generated answer, return only the elements that are relevant.
        Respond with a JSON array containing only the relevant elements.
        `;

        const response = await axios.post('https://api.openai.com/v1/completions', {
            model: 'gpt-4o',
            prompt: prompt,
            max_tokens: 1000,
            temperature: 0.5,
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        return JSON.parse(response.data.choices[0].text.trim());
    } catch (error) {
        console.error('Error filtering elements with GPT:', error);
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

        if (!finalMemoryId) {
            console.log("No memoryId provided, creating a new memory...");
            finalMemoryId = await createMemory(userQuery);
        }

        console.log(`Searching "${userQuery}" with memoryID: ${finalMemoryId}`);

        const searchResponse = await performSearchWithMemory(userQuery, finalMemoryId);
        const scoreThreshold = 5.0;
        const hits = searchResponse.hits.hits
            .filter(hit => hit._score >= scoreThreshold)
            .map(hit => ({
                _id: hit._id,
                _score: hit._score,
                ...hit._source
            }));

        const elements = hits.slice(0, 10).map(hit => {
            const source = hit;
            return {
                ...source,
                tags: source.tags === undefined || source.tags === null ? null : source.tags,
                authors: source.authors || null,
                contents: source.contents || null,
                title: source.title || null,
                contributor: source.contributor || null,
            };
        });

        // Get the answer generated by the model
        const answer = searchResponse.ext.retrieval_augmented_generation?.answer || null;

        // Use GPT to filter elements
        const filteredElements = answer ? await filterElementsWithGPT(userQuery, answer, elements) : elements;

        // Format the response
        const formattedResponse = {
            answer: answer,
            message_id: searchResponse.ext.retrieval_augmented_generation?.message_id || null,
            elements: filteredElements.length > 0 ? filteredElements : [],
            count: filteredElements.length,
        };

        res.json(formattedResponse);
    } catch (error) {
        console.error('Error performing conversational search:', error);
        res.status(500).json({ error: 'Error performing conversational search' });
    }
});

export default router;
