import { Client } from '@opensearch-project/opensearch';
import { v4 as uuidv4 } from 'uuid';
import { callLlamaModel } from './llm_modules.js';

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

    if (response?.body?.found) {
      return response.body._source;
    }
  } catch (error) {
    if (error?.body?.found === false) {
      console.log(`Memory ID ${memoryId} not found. Creating a new document.`);
    } else {
      console.error("Error retrieving memory:", error);
      throw error;
    }
  }

  // Create a new memory document if not found
  const newMemory = {
    memoryId,
    conversation: [],
    createdAt: new Date().toISOString(),
  };

  try {
    await client.index({
      index: MEMORY_INDEX,
      id: memoryId,
      body: newMemory,
    });
    console.log(`New memory created for ID ${memoryId}`);
    return newMemory;
  } catch (error) {
    console.error("Error creating new memory:", error);
    throw error;
  }
}

/**
 * Updates the chat history for a given memoryId.
 *
 * @param {string} memoryId - The memory ID to update.
 * @param {string} userQuery - The user query.
 * @param {object} response - The response object returned by handleUserQuery.
 * @returns {Promise<void>} - Resolves when the update is complete.
 */
export async function updateMemory(memoryId, userQuery, response) {
  try {
    const memory = await getOrCreateMemory(memoryId);

    // Create a new chat record
    const newChatRecord = {
      user: userQuery,
      response: {
        answer: response.answer || "I'm sorry, I couldn't generate a satisfactory answer at the moment.",
        message_id: response.message_id || uuidv4(),
        elements: response.elements.map(doc => ({
          _id: doc._id,
          _score: doc._score,
          contributor: doc.contributor,
          contents: doc.contents,
          "resource-type": doc["resource-type"],
          title: doc.title,
          authors: doc.authors || [],
          tags: doc.tags || [],
          "thumbnail-image": doc["thumbnail-image"],
        })),
        count: response.count || 0,
      },
    };

    // Append the new chat record to the conversation
    memory.conversation.push(newChatRecord);

    // Update the document in OpenSearch
    await client.index({
      index: MEMORY_INDEX,
      id: memoryId,
      body: memory,
      refresh: true,
    });
    console.log(`Memory updated for ID ${memoryId}`);
  } catch (error) {
    console.error("Error updating memory:", error);
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
    // Retrieve the chat history
    const memoryResponse = await client.get({
      index: MEMORY_INDEX,
      id: memoryId,
    });

    const chatHistory = memoryResponse.body._source.chat_history || [];

    // Optionally include the most recent k chat histories
    const recentChatHistory = recentK !== null ? chatHistory.slice(-recentK) : chatHistory;

    // Form the prompt for the LLM
    const prompt = `
      Here is the chat history:
      ${recentChatHistory.map((entry, index) => `(${index + 1}) ${entry}`).join('\n')}
      
      Here is the new user query:
      ${newUserQuery}
      
      Form a comprehensive user query considering the chat history and the new user query.
    `;

    // Call the LLM to form the comprehensive user query
    const llmResponse = await callLlamaModel({
      model: "llama3:instruct",
      messages: [
        { role: "system", content: "You are an assistant that forms comprehensive user queries." },
        { role: "user", content: prompt },
      ],
    });

    return llmResponse?.message?.content || "No response from LLM.";
  } catch (error) {
    console.error('Error forming comprehensive user query:', error);
    throw error;
  }
}
