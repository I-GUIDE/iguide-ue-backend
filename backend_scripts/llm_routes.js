import express from 'express';
import { Client } from '@opensearch-project/opensearch';
import axios from 'axios';

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

// Endpoint for LLM-based conversational search
router.post('/beta/llm-search', async (req, res) => {
    const { userQuery } = req.body;

    try {
        // Perform the search in OpenSearch
        const searchResponse = await client.search({
            index: process.env.OPENSEARCH_INDEX, // Use the correct index
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

