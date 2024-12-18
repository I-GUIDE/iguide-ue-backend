import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import spacy from 'spacy'; // Example for SpaCy-based location extraction (in Python)

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

// Function to perform search with memory in OpenSearch and optional spatial filter
export async function getSpatialSearchResult(userQuery, memoryId, boundingBox = null) {
    try {
        const searchBody = {
            query: {
                bool: {
                    must: {
                        multi_match: {
                            query: userQuery,
                            fields: ["authors^2", "contents", "title^3", "contributors^2"],
                            type: "best_fields"
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

        // Add spatial filtering if a bounding box is provided
        if (boundingBox) {
            searchBody.query.bool.filter = {
                geo_shape: {
                    bounding_box: {
                        shape: boundingBox
                    }
                }
            };
        }

        const searchResponse = await client.search({
            index: process.env.OPENSEARCH_INDEX,
            search_pipeline: 'rag_pipeline_local', // Specify the optional search pipeline
            body: searchBody
        });
        return searchResponse.body;
    } catch (error) {
        console.error('Error performing search with memory:', error);
        throw error;
    }
}

