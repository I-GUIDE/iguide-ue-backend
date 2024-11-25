import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import nlp from 'compromise';

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

// Function to extract location from user query using NLP
function extractLocationFromQuery(userQuery) {
    const doc = nlp(userQuery);
    const locations = doc.places().out('array');  // Extract locations (places)
    return locations;
}

// Function to get bounding box for location using Geocoding API
async function getBoundingBox(location) {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${location}&key=${apiKey}`);
        const locationData = response.data.results[0].geometry.bounds;

        // Return the bounding box in the format needed by OpenSearch
        return {
            "type": "polygon",
            "coordinates": [[
                [locationData.southwest.lng, locationData.southwest.lat],
                [locationData.northeast.lng, locationData.southwest.lat],
                [locationData.northeast.lng, locationData.northeast.lat],
                [locationData.southwest.lng, locationData.northeast.lat],
                [locationData.southwest.lng, locationData.southwest.lat]
            ]]
        };
    } catch (error) {
        console.error('Error fetching bounding box:', error);
        throw error;
    }
}

// Function to perform spatial search with memory in OpenSearch
async function performSpatialSearch(userQuery, memoryId, boundingBox) {
    try {
        const searchBody = {
            query: {
                bool: {
                    filter: {
                        geo_shape: {
                            bounding_box: {
                                shape: boundingBox
                            }
                        }
                    }
                }
            },
            ext: {
                generative_qa_parameters: {
                    llm_model: "llama3:latest",
                    llm_question: userQuery,
                    memory_id: memoryId
                }
            }
        };

        const searchResponse = await client.search({
            index: process.env.OPENSEARCH_INDEX_MAP,
            search_pipeline: 'rag_pipeline_maps', // Specify the optional search pipeline
            body: searchBody
        });
        return searchResponse.body;
    } catch (error) {
        console.error('Error performing spatial search with memory:', error);
        throw error;
    }
}

/**
 * @swagger
 * /beta/llm/spatial-search:
 *   post:
 *     summary: Perform a spatial search with LLM and memory integration
 *     description: This endpoint extracts locations from the user query, fetches a bounding box using Geocoding API, and performs a spatial search using OpenSearch with memory tracking.
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
 *                 description: The query entered by the user, which should contain location information.
 *                 example: Find research papers about environmental science in New York
 *               memoryId:
 *                 type: string
 *                 description: Optional memory ID to track the search session. If not provided, a new memory will be created.
 *     responses:
 *       200:
 *         description: Successfully performed spatial search
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                   description: The generated answer from the LLM.
 *                 message_id:
 *                   type: string
 *                   description: The message ID for tracking.
 *                 elements:
 *                   type: array
 *                   description: List of search results.
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         description: ID of the document.
 *                       _score:
 *                         type: number
 *                         description: Relevance score of the document.
 *                       title:
 *                         type: string
 *                         description: Title of the document.
 *                       authors:
 *                         type: array
 *                         description: List of authors.
 *                         items:
 *                           type: string
 *                       tags:
 *                         type: array
 *                         description: List of tags associated with the document.
 *                         items:
 *                           type: string
 *                       contents:
 *                         type: string
 *                         description: The main content of the document.
 *                       contributor:
 *                         type: string
 *                         description: Contributor of the document.
 *                 count:
 *                   type: integer
 *                   description: The number of documents returned in the search.
 *       400:
 *         description: Invalid request or no location found in the query.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message.
 *       500:
 *         description: Internal server error while performing the spatial search.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message.
 */
router.options('/llm/spatial-search', cors());
router.post('/llm/spatial-search', cors(), async (req, res) => {
    const { userQuery, memoryId } = req.body;

    try {
        let finalMemoryId = memoryId;
        let boundingBox = null;

        // If no memoryId is provided, create a new memory
        if (!finalMemoryId) {
            console.log("No memoryId provided, creating a new memory...");
            finalMemoryId = await createMemory(userQuery);
        }

        // Step 1: Extract locations from the user query
        const locations = extractLocationFromQuery(userQuery);
        console.log(`Extracted locations: ${locations}`);

        // Step 2: If locations are found, fetch bounding box for the first location
        if (locations.length > 0) {
            console.log(`Fetching bounding box for location: ${locations[0]}`);
            boundingBox = await getBoundingBox(locations[0]);
        } else {
            return res.status(400).json({ error: 'No valid location found in the query.' });
        }

        console.log(`Searching with memoryID: ${finalMemoryId} and bounding box ${boundingBox}`);

        // Step 3: Perform the spatial search with the provided memory ID and bounding box
        const searchResponse = await performSpatialSearch(userQuery, finalMemoryId, boundingBox);

        const scoreThreshold = 0;  // Adjust the threshold as needed
        const hits = searchResponse.hits.hits
            .filter(hit => hit._score >= scoreThreshold)
            .map(hit => ({
                _id: hit._id,
                _score: hit._score,
                ...hit._source
            }));
        console.log(hits)

        // Limit the number of elements to at most 10 and handle null fields
        const elements = hits.slice(0, 10).map(hit => ({
            ...hit,
            tags: hit.tags || null,
            authors: hit.authors || null,
            contents: hit.contents || null,
            title: hit.title || null,
            contributor: hit.contributor || null
        }));

        // Format the response
        const formattedResponse = {
            answer: searchResponse.ext.retrieval_augmented_generation?.answer || null,
            message_id: searchResponse.ext.retrieval_augmented_generation?.message_id || null,
            elements: elements.length > 0 ? elements : [],
            count: elements.length
        };

        res.json(formattedResponse);
    } catch (error) {
        console.error('Error performing spatial search:', error);
        res.status(500).json({ error: 'Error performing spatial search' });
    }
});

export default router;