import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import spacy from 'spacy';

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
    // Example with SpaCy
    const nlp = spacy.load('en_core_web_sm');
    const doc = nlp(userQuery);
    const locations = [];

    // Extract location-based entities
    doc.ents.forEach(entity => {
        if (entity.label_ === 'GPE') { // GPE = Geopolitical Entity (SpaCy's label for locations)
            locations.push(entity.text);
        }
    });
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
async function performSpatialSearch(memoryId, boundingBox) {
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
                    memory_id: memoryId
                }
            }
        };

        const searchResponse = await client.search({
            index: process.env.OPENSEARCH_INDEX_MAP,
            search_pipeline: 'rag_pipeline_local', // Specify the optional search pipeline
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
 *     summary: Perform spatial search with OpenSearch and memory integration.
 *     description: This endpoint extracts locations from the user query, fetches a bounding box, and performs a spatial search using OpenSearch and LLM.
 *     tags:
 *       - Conversational Search    
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SpatialSearchRequest'
 *     responses:
 *       200:
 *         description: Spatial search results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *                  properties:
 *                      userQuery:
 *                          type: string
 *                          description: The query entered by the user for conversational search.
 *                          example: Maps about Flood Risk in the US
 *                      memoryId:
 *                          type: string
 *                          description: The optional memory ID for the search. If not provided, a new memory will be created.
 *       400:
 *         description: No valid location found in the query.
 *       500:
 *         description: Error performing spatial search.
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

        console.log(`Searching with memoryID: ${finalMemoryId} and bounding box`);

        // Step 3: Perform the spatial search with the provided memory ID and bounding box
        const searchResponse = await performSpatialSearch(finalMemoryId, boundingBox);

        const scoreThreshold = 5.0;  // Adjust the threshold as needed
        const hits = searchResponse.hits.hits
            .filter(hit => hit._score >= scoreThreshold)
            .map(hit => ({
                _id: hit._id,
                _score: hit._score,
                ...hit._source
            }));

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
