import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import cors from 'cors';

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
        // Single coordinate => Point
        return {
            type: 'point',
            coordinates: coordsArray[0],
        };
    } else if (coordsArray.length === 2) {
        // Two pairs => Envelope
        return {
            type: 'envelope',
            coordinates: coordsArray,
        };
    } else {
        // Three or more => Polygon
        const first = coordsArray[0];
        const last = coordsArray[coordsArray.length - 1];
        // Auto-close the polygon if needed
        if (first[0] !== last[0] || first[1] !== last[1]) {
            coordsArray.push(first);
        }
        return {
            type: 'polygon',
            coordinates: [coordsArray],
        };
    }
}

/**
 * Retrieve all matching documents via the scroll API.
 * @param {Object} searchQuery - The search body.
 * @param {string} index       - The name of the OpenSearch index.
 * @param {string} scrollDuration - e.g. "30s"
 * @returns {Promise<Array>}   - All matching hits concatenated.
 */
async function scrollAllDocuments(searchQuery, index, scrollDuration = '30s') {
    // Initial search with scroll
    let response = await client.search({
        index,
        scroll: scrollDuration,
        body: searchQuery,
    });

    let allHits = response.body.hits.hits || [];
    let scrollId = response.body._scroll_id;

    // Continue scrolling while hits are returned
    while (true) {
        if (!scrollId || response.body.hits.hits.length === 0) break;

        response = await client.scroll({
            scroll: scrollDuration,
            scrollId,
        });

        scrollId = response.body._scroll_id;
        const hits = response.body.hits.hits;
        if (!hits || hits.length === 0) break;

        allHits = allHits.concat(hits);
    }

    // Clear the scroll context
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
 *     summary: Spatial search with optional text keyword
 *     tags:
 *       - Spatial Search
 *     parameters:
 *       - in: query
 *         name: coords
 *         required: true
 *         schema:
 *           type: string
 *         description: JSON array of [lon, lat] pairs. (1 => Point, 2 => Envelope, 3+ => Polygon)
 *         example: '[[-87.634938, 24.396308], [-80.031362, 24.396308], [-80.031362, 31.000968], [-87.634938, 31.000968], [-87.634938, 24.396308]]'
 *       - in: query
 *         name: keyword
 *         required: false
 *         schema:
 *           type: string
 *         description: An optional text query to match documents (e.g. "climate data").
 *         example: 'climate data'
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
 *           description: Positive integer or "unlimited" (default). "unlimited" uses scrolling to get all matches.
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
        } = req.query;

        if (!coords) {
            return res.status(400).json({
                error: 'Missing required query parameter: coords (JSON array of [lon, lat] pairs).',
            });
        }

        // 1. Parse coords
        let coordsArray;
        try {
            coordsArray = JSON.parse(coords);
        } catch (err) {
            return res.status(400).json({
                error: 'Invalid coords JSON format',
                details: err.message,
            });
        }

        // 2. Infer the GeoJSON shape
        const shape = inferShapeFromCoords(coordsArray);

        // 3. Build the query with optional keyword AND the geo_shape filter
        const boolQuery = {
            bool: {
                // If keyword is provided, add a multi_match in must
                must: keyword
                    ? [
                          {
                              multi_match: {
                                  query: keyword,
                                  fields: [
                                      'title^3',
                                      'authors^3',
                                      'tags^2',
                                      'contents',
                                      'contributor^3',
                                  ],
                                  type: 'best_fields',
                              },
                          },
                      ]
                    : [],
                filter: [
                    {
                        geo_shape: {
                            bounding_box: {// Use bounding box for spatial search
                                shape,
                                relation: relation.toUpperCase(),
                            },
                        },
                    },
                ],
            },
        };

        const searchBody = {
            query: boolQuery,
            track_total_hits: true,
        };

        // 4. If limit is numeric, do a normal search
        if (limit !== 'unlimited' && !isNaN(limit)) {
            const size = parseInt(limit, 10);
            const responseOS = await client.search({
                index: process.env.OPENSEARCH_INDEX_MAP,
                body: { ...searchBody, size },
            });
            const hits = responseOS.body?.hits?.hits || [];
            return res.json({
                total: responseOS.body.hits.total?.value || 0,
                hits: hits,
            });
        } else {
            // 5. Otherwise, attempt to scroll for all matching docs
            const allHits = await scrollAllDocuments(
                searchBody,
                process.env.OPENSEARCH_INDEX_MAP
            );
            return res.json({
                total: allHits.length,
                hits: allHits,
            });
        }
    } catch (error) {
        console.error('Error performing spatial search:', error);
        return res.status(500).json({
            error: error.message || 'Error performing spatial search',
        });
    }
});

export default router;
