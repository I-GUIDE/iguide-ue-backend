import { Client } from '@opensearch-project/opensearch';
import { v4 as uuidv4 } from 'uuid';
import { callLlamaModel, createQueryPayload } from './llm_modules.js';

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

const MEMORY_INDEX = process.env.OPENSEARCH_MEMORY_INDEX || 'chat_memory';

/**
 * Creates a new memory in OpenSearch.
 *
 * @param {string} conversationName - The name of the conversation.
 * @returns {Promise<string>} - The ID of the created memory.
 */
export async function createMemory(conversationName) {
  const memoryId = uuidv4();
  const newMemory = {
    conversationName,
    chat_history: [],
  };

  await client.index({
    index: MEMORY_INDEX,
    id: memoryId,
    body: newMemory,
  });

  return memoryId;
}

/**
 * Retrieves the chat history for a given memoryId.
 * If the document does not exist, it creates a new document.
 *
 * @param {string} memoryId - The memory ID to retrieve or create.
 * @returns {Promise<object>} - The chat history object.
 */
export async function getOrCreateMemory(memoryId) {
  try {
    // Check if the document exists
    const response = await client.get({
      index: MEMORY_INDEX,
      id: memoryId,
    });

    return response.body._source;
  } catch (error) {
    if (error.meta.statusCode === 404) {
      // Document does not exist, create a new one
      const newMemory = {
        conversationName: `conversation-${memoryId}`,
        chat_history: [],
      };

      await client.index({
        index: MEMORY_INDEX,
        id: memoryId,
        body: newMemory,
      });

      return newMemory;
    } else {
      throw error;
    }
  }
}

/**
 * Updates the memory with new chat history.
 *
 * @param {string} memoryId - The memory ID to update.
 * @param {string} userQuery - The user query to add to the chat history.
 * @param {object} response - The response to add to the chat history.
 * @returns {Promise<void>}
 */
export async function updateMemory(memoryId, userQuery, response) {
  try {
    const memoryResponse = await client.get({
      index: MEMORY_INDEX,
      id: memoryId,
    });

    const chatHistory = memoryResponse.body._source.chat_history || [];
    chatHistory.push({ userQuery, response });

    await client.update({
      index: MEMORY_INDEX,
      id: memoryId,
      body: {
        doc: {
          chat_history: chatHistory,
        },
      },
    });
  } catch (error) {
    console.error('Error updating memory:', error);
    throw error;
  }
}
/**
 * Deletes a memory document by memoryId.
 *
 * @param {string} memoryId - The memory ID to delete.
 * @returns {Promise<void>} - Resolves when the deletion is complete.
 */
export async function deleteMemory(memoryId) {
  try {
    await client.delete({
      index: MEMORY_INDEX,
      id: memoryId,
    });
    console.log(`Memory deleted for ID ${memoryId}`);
  } catch (error) {
    console.error("Error deleting memory:", error);
    if (error?.statusCode !== 404) {
      throw error;
    }
  }
}
/**
 * Forms a comprehensive user query given the new user query and the chat history in the memory.
 * Optionally includes the most recent k chat histories or lets the LLM decide if left as null.
 *
 * @param {string} memoryId - The memory ID to retrieve the chat history.
 * @param {string} newUserQuery - The new user query.
 * @param {number|null} [recentK=null] - The number of most recent chat histories to include. If null, lets the LLM decide.
 * @returns {Promise<string>} - The comprehensive user query.
 */
export async function formComprehensiveUserQuery(memoryId, newUserQuery, recentK = null) {
  try {
    // Retrieve or create the chat history
    const memory = await getOrCreateMemory(memoryId);
    const chatHistory = memory.chat_history || [];

    // Optionally include the most recent k chat histories
    const recentChatHistory = recentK !== null ? chatHistory.slice(-recentK) : chatHistory;

    // Form the prompt for the LLM
    const prompt = `
    Task: Expand the new query ONLY if it directly refers to the previous conversation. Return the original query if it's unrelated.

    Previous Questions (most recent first):
    ${recentChatHistory.length > 0 
      ? recentChatHistory.slice().reverse().map((entry) => `- ${entry.userQuery}`).join('\n')
      : "No previous questions"}

    New Query: "${newUserQuery}"

    Rules:
    1. Augment ONLY if the new query explicitly references previous questions (e.g., uses "these", "those", "any", or implies continuation)
    2. Never combine with older context if the query introduces a new topic
    3. Keep augmented queries concise (under 12 words)
    4. Respond ONLY with the final query - no explanations
    5. Do not include the terms that are not related to the context

    Examples:
    Previous: Chicago datasets
    New: Any about social media?
    Output: Chicago datasets related to social media

    Previous: Chicago datasets
    New: Show climate data
    Output: Climate data
    `.trim();
    //console.log('Prompt for comprehensive chat question:', prompt);

    // Call the LLM to form the comprehensive user query
    var payload = createQueryPayload("llama3.2:latest", "You are an assistant that forms comprehensive user queries based on the new query and the previous questions. Only expand the query if it lacks background or is a followup question of the previous questions. Otherwise, keep the query as is. Avoid adding additional backgrounds. If there is no chat history just return the original query.", prompt)
    const llmResponse = await callLlamaModel(payload);
    //console.log("Comprehensive quesiton: ", llmResponse);
    return llmResponse?.message?.content || "No response from LLM.";
  } catch (error) {
    console.error('Error forming comprehensive user query:', error);
    throw error;
  }
}