import { Client } from '@opensearch-project/opensearch';
import { getComprehensiveSchema, agentSearchWithLLM } from './neo4j_agent.js';

const client = new Client({
  node: 'https://10.0.147.253:9200' || process.env.OPENSEARCH_NODE,
  auth: {
    username: process.env.OPENSEARCH_USERNAME,
    password: process.env.OPENSEARCH_PASSWORD,
  },
  ssl: {
    rejectUnauthorized: false,
  },
});

export async function getKeywordSearchResults(userQuery) {
  try {
    const response = await client.search({
      index: 'neo4j-elements-knn' || process.env.OPENSEARCH_INDEX,
      size: 5,
      body: {
        query: { match: { contents: userQuery } },
      },
    });
    return response.body.hits.hits;
  } catch (error) {
    console.error("Error connecting to OpenSearch:", error);
    return [];
  }
}

export async function getEmbeddingFromFlask(userQuery) {
  try {
    const flaskUrl = process.env.FLASK_EMBEDDING_URL;
    const response = await fetch(`${flaskUrl}/get_embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userQuery }),
    });
    if (!response.ok) throw new Error(`Error from Flask server: ${response.statusText}`);
    return (await response.json()).embedding;
  } catch (error) {
    console.error("Error getting embedding from Flask server:", error);
    return null;
  }
}

export async function getSemanticSearchResults(userQuery) {
  const embedding = await getEmbeddingFromFlask(userQuery);
  if (!embedding) return [];
  try {
    const response = await client.search({
      index: 'neo4j-elements-knn' || process.env.OPENSEARCH_INDEX,
      body: {
        size: 5,
        query: {
          knn: { 'contents-embedding': { vector: embedding, k: 3 } },
        },
      },
    });
    return response.body.hits.hits;
  } catch (error) {
    console.error("Error connecting to OpenSearch:", error);
    return [];
  }
}
export async function getNeo4jSearchResults(userQuery) {
  try {
    const schema = await getComprehensiveSchema(); // cached schema
    const result = await agentSearchWithLLM(userQuery, schema);

    if (!result || !Array.isArray(result.results)) {
      console.warn("Neo4j agent returned no usable results.");
      return [];
    }

    // Normalize result format (like OpenSearch hits)
    return result.results.map((doc, i) => ({
      _id: doc._id,
      _score: doc._score ?? 1.0,
      _source: {
        contributor: doc.contributor,
        contents: doc.contents,
        "resource-type": doc["resource-type"],
        title: doc.title,
        authors: doc.authors || [],
        tags: doc.tags || [],
        "thumbnail-image": doc["thumbnail-image"],
        click_count: doc.click_count ?? 0
      }
    }));
  } catch (error) {
    console.error("Error in getNeo4jSearchResults:", error);
    return [];
  }
}