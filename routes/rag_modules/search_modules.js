import { Client } from '@opensearch-project/opensearch';

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
        size: 15,
        query: {
          knn: { 'contents-embedding': { vector: embedding, k: 10 } },
        },
      },
    });
    return response.body.hits.hits;
  } catch (error) {
    console.error("Error connecting to OpenSearch:", error);
    return [];
  }
}
