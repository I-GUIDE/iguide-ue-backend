import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import compromise from 'compromise'; // JavaScript NLP alternative

const router = express.Router();

// Initialize OpenSearch client (same as before)
const client = new Client({
    node: 'https://149.165.169.165:9200' || process.env.OPENSEARCH_NODE,
    auth: {
        username: process.env.OPENSEARCH_USERNAME,
        password: process.env.OPENSEARCH_PASSWORD,
    },
    ssl: {
        rejectUnauthorized: false,
    },
});

// Updated location extraction with compromise
function extractLocationFromQuery(userQuery) {
    const doc = compromise(userQuery);
    const places = doc.places().out('array');
    return places;
}

// Improved bounding box handling
async function getBoundingBox(location) {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`
        );

        if (!response.data.results.length) return null;
        
        const geometry = response.data.results[0].geometry;
        let bounds = geometry.bounds || geometry.viewport;

        if (!bounds) {
            const buffer = 0.1;
            const lat = geometry.location.lat;
            const lng = geometry.location.lng;
            bounds = {
                southwest: { lat: lat - buffer, lng: lng - buffer },
                northeast: { lat: lat + buffer, lng: lng + buffer }
            };
        }

        // Return as Polygon coordinates matching your document structure
        return {
            "type": "polygon",
            "coordinates": [
                [
                    [bounds.southwest.lng, bounds.southwest.lat],
                    [bounds.northeast.lng, bounds.southwest.lat],
                    [bounds.northeast.lng, bounds.northeast.lat],
                    [bounds.southwest.lng, bounds.northeast.lat],
                    [bounds.southwest.lng, bounds.southwest.lat]  // Close the polygon
                ]
            ]
        };

    } catch (error) {
        console.error('Error fetching bounding box:', error);
        return null;
    }
}

// Updated search function
export async function getSpatialSearchResults(userQuery, memoryId) {
    try {
        const locations = extractLocationFromQuery(userQuery);
        let boundingBox = null;

        if (locations.length > 0) {
            boundingBox = await getBoundingBox(locations[0]);
        }

        // Build the base query
        const searchBody = {
            query: {
                bool: {
                    should: [],  // Use should instead of must for OR logic
                    filter: []
                }
            }
        };

        // Add text search (using correct field name "contents")
        /*if (userQuery) {
            searchBody.query.bool.should.push({
                match: {
                    contents: userQuery  // Changed from "content" to "contents"
                }
            });
        }*/

        // Add spatial filter
        if (boundingBox) {
            //console.log('Generated Bounding Box:', JSON.stringify(boundingBox, null, 2));
            searchBody.query.bool.filter.push({
                geo_shape: {
                    "spatial-bounding-box-geojson": {
                        shape: boundingBox,
                        relation: 'intersects'
                    }
                }
            });
        }

        // Add a match_all if no specific queries
        if (searchBody.query.bool.should.length === 0) {
            searchBody.query.bool.should.push({ match_all: {} });
        }

        //console.log('Final Query:', JSON.stringify(searchBody, null, 2));

        const searchResponse = await client.search({
            index: 'neo4j-elements-vspatial-v2',  // Hardcoded for safety
            body: searchBody
        });

        return searchResponse.body.hits.hits || [];

    } catch (error) {
        console.error('Error performing spatial search:', error);
        throw error;
    }
}