import express from 'express';
import axios from 'axios';
// import { v4 as uuidv4 } from 'uuid';  // For generating unique IDs

const router = express.Router();

// Llama API details
const LLAMA_API_URL = process.env.ANVILGPT_URL;
const ANVIL_GPT_API_KEY = process.env.ANVILGPT_KEY;

// Middleware to parse JSON request bodies
router.use(express.json());

router.post('/v1/chat/completions', async (req, res) => {
    try {
        // Get the input data (assumed to be JSON)
        const inputData = req.body;

        // Add "stream": false to the input data
        inputData["stream"] = false;

        // Forward the request to the Llama API
        const llamaResponse = await axios.post(LLAMA_API_URL, inputData, {
            headers: {
                'Authorization': `Bearer ${ANVIL_GPT_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Check if the response from the Llama API is successful
        if (llamaResponse.status === 200) {
            const llamaData = llamaResponse.data;  // Extract data from the response

            // Format the response to match the OpenAI structure
            const openaiFormattedResponse = {
                id: `chatcmpl-12138`,  // Or you can use uuidv4() for unique ID
                object: "chat.completion",
                created: Math.floor(new Date(llamaData.created_at).getTime() / 1000),  // Convert timestamp to seconds
                model: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",  // Define the model name
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: llamaData.message.content  // Get the content from the Llama response
                        },
                        logprobs: null,  // Assuming logprobs are not returned by Llama
                        finish_reason: llamaData.done_reason  // "stop" or similar
                    }
                ],
                usage: {
                    prompt_tokens: llamaData.prompt_eval_count || 0,  // Estimate or track prompt tokens
                    completion_tokens: llamaData.eval_count || 0,  // Estimate or track completion tokens
                    total_tokens: (llamaData.prompt_eval_count || 0) + (llamaData.eval_count || 0)
                },
                system_fingerprint: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
            };

            // Send back the formatted response
            res.json(openaiFormattedResponse);
        } else {
            // Handle errors from Llama API
            res.status(llamaResponse.status).json({ error: 'Llama API request failed' });
        }

    } catch (error) {
        // Handle any other errors (network issues, etc.)
        res.status(500).json({ error: error.message });
    }
});

// Export the router to use in your app
export default router;
