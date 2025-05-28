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
    console.log(`Checking memory for ID ${memoryId}`);
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
export async function getMemory(memoryId) {
  try {
    // Check if the document exists
    console.log(`Checking memory for ID ${memoryId}`);
    const response = await client.get({
      index: MEMORY_INDEX,
      id: memoryId,
    });

    return response.body._source;
  }catch (error) {
    if (error.meta.statusCode === 404) {
      // Document does not exist, return null
      console.log(`Memory not found for ID ${memoryId}`);
      return null;
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
/**
 * Persist an exchange + optional rating block
 * @param {string} memoryId
 * @param {string} userQuery
 * @param {string} messageId
 * @param {string} answer
 * @param {Array<Object>} elements
 * @param {Object} ratings   // { relevance:1…5, sufficiency:1…5, … }
 */
export async function updateMemory(
  memoryId,
  userQuery,
  messageId,
  answer,
  elements,
  ratings = null          // <- new optional arg
) {
  try {
    const { body } = await client.get({ index: MEMORY_INDEX, id: memoryId });
    const chatHistory = body._source.chat_history || [];

    chatHistory.push({
      userQuery,
      messageId,
      answer,
      elements,
      ...(ratings && { ratings })   // only attach if provided
    });

    await client.update({
      index: MEMORY_INDEX,
      id   : memoryId,
      body : {
        doc: { chat_history: chatHistory }
      }
      // no script needed – partial merge is fine :contentReference[oaicite:1]{index=1}
    });
  } catch (err) {
    console.error('Error updating memory:', err);
    throw err;
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
    const memory = await getMemory(memoryId);
    if (!memory) {
      return null; // Memory not found
    }
    const chatHistory = memory.chat_history || [];

    // Optionally include the most recent k chat histories
    const recentChatHistory = recentK !== null ? chatHistory.slice(-recentK) : chatHistory;

    // Form the prompt for the LLM
    const systemPrompt = `Task: Expand the new query ONLY if it directly refers to the previous conversation. Return the original query if it's unrelated.
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
    Output: Climate data`.trim();
    const userPrompt = `
    Previous Questions (most recent first):
    ${recentChatHistory.length > 0 
      ? recentChatHistory.slice().reverse().map((entry) => `- ${entry.userQuery}`).join('\n')
      : "No previous questions"}

    New Query: "${newUserQuery}"
    `.trim();
    //console.log('Prompt for comprehensive chat question:', prompt);

    // Call the LLM to form the comprehensive user query
    var payload = createQueryPayload("qwen2.5:7b-instruct", systemPrompt, userPrompt, 0.8, 0.9)
    const llmResponse = await callLlamaModel(payload);
    //console.log("Comprehensive quesiton: ", llmResponse);
    return llmResponse || "No response from LLM.";
  } catch (error) {
    console.error('Error forming comprehensive user query:', error);
    throw error;
  }
}

export async function updateRating(memoryId, messageId, ratings) {
  try {
    await client.update({
      index: MEMORY_INDEX,
      id   : memoryId,
      body : {
        script: {
          lang: 'painless',
          source: `
            boolean found = false;
            for (item in ctx._source.chat_history) {
              if (item.messageId == params.mid) {
                item.ratings = params.ratings;   // add or overwrite
                found = true;
                break;
              }
            }
            if (!found) ctx.op = 'none';         // Do nothing if not found
          `,
          params: { mid: messageId, ratings }
        }
      },
      refresh: 'false'                           // async for speed
    });
  } catch (err) {
    console.error('updateRating error:', err);
    throw err;
  }
}