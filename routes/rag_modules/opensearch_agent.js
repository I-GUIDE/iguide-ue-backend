import { Client } from '@opensearch-project/opensearch';
import { callLlamaModel, createQueryPayload } from './llm_modules.js';

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
 * Generate an OpenSearch DSL query for spatial and temporal search using LLM.
 * @param {string} question - The user's question.
 * @param {object} schema - The index mapping/schema (optional, can be extended).
 * @returns {string} - OpenSearch DSL query as a JSON string.
 */
export async function generateOpenSearchQueryFromSchema(question, schema = {}) {
  const systemPrompt = `
You are an expert in OpenSearch DSL queries.
Given a user question, generate an OpenSearch query for the "iguide" index that supports spatial and temporal search.

The index schema includes:
- Text fields: authors, contributor, contents, title, tags, resource-type
- Embeddings: contents-embedding (knn_vector), pdf_chunks.embedding (knn_vector)
- Nested PDF chunks: pdf_chunks (with chunk_id, text, embedding)
- Spatial fields (geo_shape): spatial-bounding-box-geojson, spatial-centroid-geojson, spatial-geometry-geojson
- Temporal/spatial coverage: spatial-temporal-coverage, spatial-index-year
- Other spatial fields: spatial-bounding-box, spatial-centroid, spatial-coverage, spatial-geometry, spatial-georeferenced

Guidelines:
- For spatial queries, use geo_shape queries on "spatial-bounding-box-geojson", "spatial-centroid-geojson", or "spatial-geometry-geojson".
- For temporal queries, use match or range queries on "spatial-temporal-coverage" or "spatial-index-year".
- For semantic search, use knn queries on "contents-embedding" or nested "pdf_chunks.embedding".
- If both spatial and temporal constraints are present, combine them using a bool filter.
- Limit results to 10.
- Only return the JSON for the OpenSearch query body. Do not include explanations or formatting.

Example spatial query:
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        {
          "geo_shape": {
            "spatial-bounding-box-geojson": {
              "shape": {
                "type": "envelope",
                "coordinates": [[-88.3, 40.2], [-88.2, 40.1]]
              },
              "relation": "intersects"
            }
          }
        }
      ]
    }
  }
}

Example temporal query:
{
  "size": 10,
  "query": {
    "match": {
      "spatial-index-year": "2022"
    }
  }
}

Example spatial-temporal query:
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        {
          "geo_shape": {
            "spatial-geometry-geojson": {
              "shape": {
                "type": "point",
                "coordinates": [-88.25, 40.15]
              },
              "relation": "intersects"
            }
          }
        },
        {
          "match": {
            "spatial-temporal-coverage": "2022"
          }
        }
      ]
    }
  }
}

If the question cannot be answered with spatial or temporal search, return: "{}"
  `.trim();

  const userPrompt = `User question: ${question}`;

  const payload = createQueryPayload(
    "qwen2.5:7b-instruct",
    systemPrompt,
    userPrompt
  );
  payload.temperature = 0.1;
  payload.top_p = 0.8;

  const response = await callLlamaModel(payload);
  const queryBody = response?.trim();
  return queryBody;
}

/**
 * Run the generated OpenSearch query.
 * @param {string|object} queryBody - The OpenSearch query body (JSON string or object).
 * @returns {Array} - Array of matching documents.
 */
export async function runOpenSearchQuery(queryBody) {
  let body;
  try {
    body = typeof queryBody === 'string' ? JSON.parse(queryBody) : queryBody;
  } catch (err) {
    console.error("Failed to parse OpenSearch query body:", err);
    return [];
  }

  try {
    const response = await client.search({
      index: process.env.OPENSEARCH_INDEX,
      body,
    });
    return response.body.hits.hits.map(hit => ({
      _id: hit._id,
      _score: hit._score,
      ...hit._source,
    }));
  } catch (error) {
    console.error("OpenSearch query execution failed:", error);
    return [];
  }
}

/**
 * Agent function: generates and runs an OpenSearch query for spatial/temporal search.
 * @param {string} question - The user's question.
 * @param {object} schema - Optional index schema.
 * @returns {object} - { generation, results }
 */
export async function agentSpatialTemporalSearchWithLLM(question, schema = {}) {
  const queryBody = await generateOpenSearchQueryFromSchema(question, schema);

  if (queryBody === "{}") {
    return {
      generation: "Sorry, I can't answer this with spatial or temporal search.",
      results: [],
    };
  }

  console.log("OpenSearch Agent: Generated Query Body:\n", queryBody);
  const results = await runOpenSearchQuery(queryBody);
  return {
    generation: `Query: ${queryBody}`,
    results,
  };
}

/**
 * Fetch and cache the OpenSearch index schema (mapping).
 * @param {string} indexName - The index to get the schema for.
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh.
 * @returns {object} - The index mapping/schema.
 */
let schemaCache = null;
let lastSchemaFetchTime = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getOpenSearchSchema(indexName = process.env.OPENSEARCH_INDEX, forceRefresh = false) {
  const now = Date.now();
  const isExpired = !lastSchemaFetchTime || (now - lastSchemaFetchTime > CACHE_TTL_MS);

  if (!forceRefresh && schemaCache && !isExpired) {
    return schemaCache;
  }

  try {
    const response = await client.indices.getMapping({ index: indexName });
    schemaCache = response.body[indexName]?.mappings || {};
    lastSchemaFetchTime = now;
    return schemaCache;
  } catch (error) {
    console.error("Error fetching OpenSearch schema:", error);
    return {};
  }
}