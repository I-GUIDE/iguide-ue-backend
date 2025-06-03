import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';
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

/**
 * Infers a GeoJSON shape from coordinate pairs:
 *   - 1 pair  => Point
 *   - 2 pairs => Envelope (top-left, bottom-right)
 *   - ≥3 pairs => Polygon (auto-close)
 */
function inferShapeFromCoords(coordsArray) {
    if (!Array.isArray(coordsArray) || coordsArray.length === 0) {
        throw new Error('Coordinates must be a non-empty array of [lon, lat] pairs.');
    }

    if (coordsArray.length === 1) {
        return { type: 'point', coordinates: coordsArray[0] };
    } else if (coordsArray.length === 2) {
        return { type: 'envelope', coordinates: coordsArray };
    } else {
        const first = coordsArray[0];
        const last = coordsArray[coordsArray.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            coordsArray.push(first);
        }
        return { type: 'polygon', coordinates: [coordsArray] };
    }
}

/**
 * Retrieve all matching documents via the scroll API.
 */
async function scrollAllDocuments(searchQuery, index, scrollDuration = '30s') {
    let response = await client.search({ index, scroll: scrollDuration, body: searchQuery });

    let allHits = response.body.hits.hits || [];
    let scrollId = response.body._scroll_id;

    while (true) {
        if (!scrollId || response.body.hits.hits.length === 0) break;

        response = await client.scroll({ scroll: scrollDuration, scrollId });
        scrollId = response.body._scroll_id;
        const hits = response.body.hits.hits;
        if (!hits || hits.length === 0) break;

        allHits = allHits.concat(hits);
    }

    if (scrollId) {
        try {
            await client.clearScroll({ scrollId });
        } catch (err) {
            console.warn('Error clearing scroll:', err.message);
        }
    }

    return allHits;
}
/**
 * @swagger
 * /api/search/spatial:
 *   get:
 *     summary: Spatial search with optional text keyword and element-type
 *     tags:
 *       - Spatial Search
 *     parameters:
 *       - in: query
 *         name: coords
 *         required: true
 *         schema:
 *           type: string
 *         description: JSON array of [lon, lat] pairs. 
 *           - **1 pair** => Point  
 *           - **2 pairs** => Envelope  
 *           - **3+ pairs** => Polygon  
 *         example: '[[-87.634938, 24.396308], [-80.031362, 24.396308], [-80.031362, 31.000968], [-87.634938, 31.000968], [-87.634938, 24.396308]]'
 *       - in: query
 *         name: keyword
 *         required: false
 *         schema:
 *           type: string
 *         description: An optional text query to match documents (e.g. "climate data").
 *         example: 'climate data'
 *       - in: query
 *         name: element-type
 *         required: false
 *         schema:
 *           type: string
 *         description: If provided, filter results where resource-type matches this value exactly.
 *         example: 'map'
 *       - in: query
 *         name: relation
 *         required: false
 *         schema:
 *           type: string
 *           enum: [INTERSECTS, WITHIN, CONTAINS, DISJOINT, OVERLAPS]
 *           default: INTERSECTS
 *         description: The spatial relation to apply.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: string
 *           description: Positive integer or "unlimited" (default). "unlimited" uses scrolling to retrieve all matches.
 *           default: "unlimited"
 *         example: "unlimited"
 *     responses:
 *       200:
 *         description: A successful response containing spatial + optional keyword-based search results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Number of matching documents.
 *                 hits:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Invalid or missing parameters.
 *       500:
 *         description: Server error performing the spatial search.
 */
router.options('/search/spatial', cors());

router.get('/search/spatial', cors(), async (req, res) => {
    try {
        const {
            coords,
            keyword,
            relation = 'INTERSECTS',
            limit = 'unlimited',
            'element-type': elementType,
        } = req.query;

        if (!coords) {
            return res.status(400).json({ error: 'Missing required query parameter: coords (JSON array of [lon, lat] pairs).' });
        }

        // Parse coordinates
        let coordsArray;
        try {
            coordsArray = JSON.parse(coords);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid coords JSON format', details: err.message });
        }

        // Infer the GeoJSON shape
        const shape = inferShapeFromCoords(coordsArray);
        console.log('Inferred shape:', shape, 'for coordinates:', coordsArray);
        // Build the query
        const boolQuery = {
            bool: {
                must: keyword
                    ? [
                        {
                            multi_match: {
                                query: keyword,
                                fields: ['title^3', 'authors^3', 'tags^2', 'contents', 'contributor^3'],
                                type: 'best_fields',
                            },
                        },
                    ]
                    : [],
                filter: [
                    {
                        geo_shape: {
                            'spatial-bounding-box-geojson': {
                                shape,
                                relation: relation.toUpperCase(),
                            },
                        },
                    },
                ],
            },
        };

        // Filter by element-type if provided
        if (elementType) {
            boolQuery.bool.filter.push({ term: { 'resource-type': elementType } });
        }

        const searchBody = { query: boolQuery, track_total_hits: true };

        let results;
        if (limit !== 'unlimited' && !isNaN(limit)) {
            const size = parseInt(limit, 10);
            const responseOS = await client.search({ index: process.env.OPENSEARCH_INDEX, body: { ...searchBody, size } });
            results = responseOS.body?.hits?.hits || [];
        } else {
            results = await scrollAllDocuments(searchBody, process.env.OPENSEARCH_INDEX);
        }

        // Format response with required fields
        const formattedResults = results.map((hit) => ({
            id: hit._id,
            //id: 'c3f284fa-54c3-4939-a68d-a3f2d26efec1',
            authors: hit._source.authors || 'Unknown',
            title: hit._source.title || 'Untitled',
            'resource-type': hit._source['resource-type'],
            contents: hit._source.contents || 'No description available',
            contributor: hit._source.contributor || 'Unknown',
            'thumbnail-image': utils.generateMultipleResolutionImagesFor(hit._source['thumbnail-image']),
            'bounding-box': hit._source['spatial-bounding-box-geojson'] || null,
            'centroid': hit._source['spatial-centroid'].replace(/[^\d .-]/g,'').trim().split(/\s+/).map(Number) || null,
        }));

        return res.json({elements: formattedResults });
    } catch (error) {
        console.error('Error performing spatial search:', error);
        return res.status(500).json({ error: error.message || 'Error performing spatial search' });
    }
});

export default router;
