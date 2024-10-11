import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import axios from 'axios';
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
        { multi_match: { query: keyword, fields: ['title^3', 'authors^3', 'tags^2', 'contents'] } }
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

    // Replace title and authors with their keyword sub-fields for sorting
    let sortBy = sort_by;
    if (sortBy === 'title') {
        sortBy = 'title.keyword';
    } else if (sortBy === 'authors') {
        sortBy = 'authors.keyword';
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
router.get('/search', cors(), async (req, res) => {
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
        { multi_match: { query: keyword, fields: ['title^3', 'authors^3', 'tags^2', 'contents'] } }
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

    // Replace title and authors with their keyword sub-fields for sorting
    let sortBy = sort_by;
    if (sortBy === 'title') {
        sortBy = 'title.keyword';
    } else if (sortBy === 'authors') {
        sortBy = 'authors.keyword';
    }

    try {
        const searchParams = {
            index: process.env.OPENSEARCH_INDEX,
            body: {
                from: parseInt(from, 10),
                size: parseInt(size, 10),
                query: query,
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
        const results = searchResponse.body.hits.hits.map(hit => {
            const { _id, _source } = hit;
            const { metadata, ...rest } = _source; // Remove metadata
            return { _id, ...rest };
        });

        res.json({ elements: results, total_count: searchResponse.body.hits.total.value });
    } catch (error) {
        console.error('Error querying OpenSearch:', error);
        res.status(500).json({ error: 'Error querying OpenSearch' });
    }
});

export default router;
