import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import axios from 'axios';
import cors from 'cors';
const router = express.Router();
import { Filter } from 'bad-words'
const customFilter = new Filter();

// local imports
import * as utils from '../utils.js';

// Override the replace method to replace bad words with an empty string
customFilter.replaceWord = (word) => '';

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
const saveSearchKeyword = async (keyword) => {
    try {
        await client.index({
            index: 'search_keywords',
            body: {
                keyword,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error saving search keyword:', error);
    }
};
/**
 * @swagger
 * /api/search/count:
 *   get:
 *     summary: Search for elements
 *     tags:
 *       - Advanced Search
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema:
 *           type: string
 *       - in: query
 *         name: element-type
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort-by
 *         schema:
 *           type: string
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: from
 *         schema:
 *           type: integer
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *       - in: query
 *         name: additional-fields
 *         schema:
 *           type: object
 *           additionalProperties:
 *             type: string
 *     responses:
 *       200:
 *         description: A list of search results
 *       500:
 *         description: Error querying OpenSearch
 */
router.options('/search/count', cors());
router.get('/search/count', cors(), async (req, res) => {
    const { keyword, 'element-type': element_type, 'sort-by': sort_by = '_score', order = 'desc', from = 0, size = 15, ...additionalFields } = req.query;

    let query = {
	multi_match: {
            query: keyword,
            fields: [
                'title^3',    // Boost title matches
                'authors^3',  // Boost author matches
                'tags^2',     // Slightly boost tag matches
                'contents'    // Normal weight for content matches
            ],
        },
    };

    // Build a list of must conditions for bool query
    const mustConditions = [
        { multi_match: { query: keyword, fields: ['title^3', 'authors^3', 'tags^2', 'contents', 'contributor^3'] } }
    ];

    if (element_type && element_type !== 'any') {
        mustConditions.push({ term: { 'resource-type': element_type } });
    }

    // Add additional fields as match conditions
    for (const [field, value] of Object.entries(additionalFields)) {
        if (field !== 'sort_by' && field !== 'order' && field !== 'from' && field !== 'size') {
            mustConditions.push({ match: { [field]: value } });
        }
    }

    // Combine all must conditions into the bool query
    if (mustConditions.length > 1) {
        query = {
            bool: {
                must: mustConditions,
            },
        };
    }

    // Replace title=, authors, and contributors with their keyword sub-fields for sorting
    let sortBy = sort_by;
    if (sortBy === 'title') {
        sortBy = 'title.keyword';
    } else if (sortBy === 'authors') {
        sortBy = 'authors.keyword';
    } else if (sortBy === 'contributor') {
        sortBy = 'contributor.keyword';
    }


    try {
        const searchParams = {
            index: process.env.OPENSEARCH_INDEX,
            body: {
                from: parseInt(from, 10),
                size: parseInt(size, 10),
                query: query,
                aggs: {
                    resource_type_counts: {
                        terms: {
                            field: 'resource-type',
                        },
                    },
                },
            },
        };

        // Add sorting unless sort_by is "prioritize_title_author"
        if (sort_by !== 'prioritize_title_author') {
            searchParams.body.sort = [
                {
                    [sortBy]: {
                        order: order,
                    },
                },
            ];
        }

        const searchResponse = await client.search(searchParams);

        // Map search hits
        const results = searchResponse.body.hits.hits.map(hit => {
            const { _id, _source } = hit;
            const { metadata, ...rest } = _source; // Remove metadata
            return { _id, ...rest };
        });

        // Get resource-type aggregation counts
        const resourceTypeCounts = searchResponse.body.aggregations.resource_type_counts.buckets.map(bucket => ({
            "element-type": bucket.key,
            count: bucket.doc_count,
        }));

        res.json({
            total_count: searchResponse.body.hits.total.value,
            resource_type_counts: resourceTypeCounts,  // Return counts by resource-type
        });
    } catch (error) {
        console.error('Error querying OpenSearch:', error);
        res.status(500).json({ error: 'Error querying OpenSearch' });
    }
});

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Search for elements
 *     tags:
 *       - Advanced Search
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema:
 *           type: string
 *       - in: query
 *         name: element-type
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort-by
 *         schema:
 *           type: string
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: from
 *         schema:
 *           type: integer
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *       - in: query
 *         name: additional-fields
 *         schema:
 *           type: object
 *           additionalProperties:
 *             type: string
 *     responses:
 *       200:
 *         description: A list of search results
 *       500:
 *         description: Error querying OpenSearch
 */
router.options('/search', cors());

router.options('/search', cors());

router.get('/search', cors(), async (req, res) => {
    const { keyword, 'element-type': element_type, 'sort-by': sort_by = '_score', order = 'desc', from = 0, size = 15, ...additionalFields } = req.query;

    // Build must conditions for both main query and aggregation
    const mustConditions = [
        { multi_match: { query: keyword, fields: ['title^3', 'authors^3', 'tags^2', 'contents', 'contributor^3'] } }
    ];

    // Add additional fields as match conditions
    for (const [field, value] of Object.entries(additionalFields)) {
        if (field !== 'sort_by' && field !== 'order' && field !== 'from' && field !== 'size') {
            mustConditions.push({ match: { [field]: value } });
        }
    }

    // Main query includes `element-type` if specified
    const mainQuery = {
        bool: {
            must: [...mustConditions],
            ...(element_type && element_type !== 'any' ? { filter: [{ term: { 'resource-type': element_type } }] } : {}),
        },
    };

    // Aggregation query excludes `element-type` filter but includes other filters
    const aggregationQuery = {
        bool: {
            must: [...mustConditions],
        },
    };

    try {
        // Main query for search results
        const searchParams = {
            index: process.env.OPENSEARCH_INDEX,
            body: {
                from: parseInt(from, 10),
                size: parseInt(size, 10),
                query: mainQuery,
            },
        };

        // Aggregation query for total count by types
        const aggregationParams = {
            index: process.env.OPENSEARCH_INDEX,
            body: {
                size: 0, // No documents returned
                query: aggregationQuery,
                aggs: {
                    resource_type_counts: {
                        terms: {
                            field: 'resource-type',
                        },
                    },
                },
            },
        };

        // Add sorting to the main query unless sort_by is "prioritize_title_author"
        if (sort_by !== 'prioritize_title_author') {
            searchParams.body.sort = [
                {
                    [sort_by === 'title' ? 'title.keyword' : sort_by === 'authors' ? 'authors.keyword' : sort_by === 'contributor' ? 'contributor.keyword' : sort_by]: {
                        order: order,
                    },
                },
            ];
        }

        // Execute both queries concurrently
        const [searchResponse, aggregationResponse] = await Promise.all([
            client.search(searchParams),
            client.search(aggregationParams),
        ]);

        // Process search results
        const results = searchResponse.body.hits.hits.map(hit => {
            const { _id, _source } = hit;
            const { metadata, ...rest } = _source; // Remove metadata
            return { _id, ...rest };
        });

        // Process aggregation results
        const resourceTypeCounts = aggregationResponse.body.aggregations.resource_type_counts.buckets.map(bucket => ({
            "element-type": bucket.key,
            count: bucket.doc_count,
        }));

        // Save the keyword if it's valid and cleaned
        if (searchResponse.body.hits.total.value > 0) {
            const cleanedKeyword = customFilter.clean(keyword).trim();
            if (cleanedKeyword === keyword) {
                await saveSearchKeyword(cleanedKeyword);
            }
        }

        // Generate multiple resolution images if available
        results.forEach(result => {
            if (result['thumbnail-image']) {
                result['thumbnail-image'] = utils.generateMultipleResolutionImagesFor(result['thumbnail-image']);
            }
        });

        res.json({
            elements: results,
            total_count: searchResponse.body.hits.total.value,
            total_count_by_types: resourceTypeCounts, // Include counts by type considering additionalFields
        });
    } catch (error) {
        console.error('Error querying OpenSearch:', error);
        res.status(500).json({ error: 'Error querying OpenSearch' });
    }
});


/**
 * @swagger
 * /api/top-keywords:
 *   get:
 *     summary: Retrieve the most searched keywords within a specified time window
 *     tags:
 *       - Advanced Search
 *     parameters:
 *       - in: query
 *         name: k
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of top keywords to retrieve
 *       - in: query
 *         name: t
 *         schema:
 *           type: integer
 *           default: 24
 *         description: Time window in hours to filter keywords (e.g., 24 for the past 24 hours)
 *     responses:
 *       200:
 *         description: A list of the most searched keywords within the specified time window
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 top_keywords:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       keyword:
 *                         type: string
 *                       count:
 *                         type: integer
 *                   description: List of top keywords and their respective counts
 *       500:
 *         description: Error retrieving top keywords
 */

router.options('/top-keywords', cors());
router.get('/top-keywords', cors(), async (req, res) => {
    const { k = 10, t = 24 } = req.query; // default: top 10 keywords within the last 24 hours

    // Calculate the time window based on `t` in hours
    const timeWindow = new Date(Date.now() - t * 60 * 60 * 1000).toISOString();

    try {
        const response = await client.search({
            index: 'search_keywords',
            body: {
                query: {
                    range: {
                        timestamp: {
                            gte: timeWindow
                        }
                    }
                },
                aggs: {
                    popular_keywords: {
                        terms: {
                            field: 'keyword.keyword',  // Use the keyword sub-field for exact match
                            size: parseInt(k, 10)     // Limit results to top `k`
                        }
                    }
                },
                size: 0  // We only want the aggregation results, not the documents
            }
        });

        const topKeywords = response.body.aggregations.popular_keywords.buckets.map(bucket => ({
            keyword: bucket.key,
            count: bucket.doc_count
        }));

        res.json({ top_keywords: topKeywords });
    } catch (error) {
        console.error('Error retrieving top keywords:', error);
        res.status(500).json({ error: 'Error retrieving top keywords' });
    }
});

export default router;
