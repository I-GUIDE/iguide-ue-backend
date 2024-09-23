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
 * /beta/llm-search:
 *   post:
 *     summary: Perform LLM-based conversational search
 *     description: Searches for knowledge elements using OpenSearch with a custom RAG pipeline.
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

router.options('/llm-search', cors());
router.post('/llm-search', cors(), async (req, res) => {
    const { userQuery } = req.body;

    try {
        // Perform the search in OpenSearch
        const searchResponse = await client.search({
            index: process.env.OPENSEARCH_INDEX,
            search_pipeline: 'rag_pipeline', //Specify the optional search pipeline
            body: {
                query: {
                    multi_match: {
                        query: userQuery,
                        fields: ["authors", "tags", "contents", "title", "contributors"],
                        type: "best_fields" //"best_fields" for best matching or "cross_fields" for combined matching
                    }
                },
                ext: {
                    generative_qa_parameters: {
                        llm_model: "gpt-4o", 
                        llm_question: userQuery,
                        context_size: 5,
                        message_size: 5,
                        timeout: 15
                    }
                }
            }
        });

        // Send the OpenSearch results to the user
        res.json(searchResponse.body);
    } catch (error) {
        console.error('Error performing conversational search:', error);
        res.status(500).json({ error: 'Error performing conversational search' });
    }
});

export default router;

