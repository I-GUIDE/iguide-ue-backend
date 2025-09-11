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
- For spatial queries, use geo_shape queries inside the "filter" array.
- For temporal queries, use range or match queries inside the "filter" array.
- For keyword/semantic queries (e.g., match), use the "must" array.
- If both spatial/temporal and keyword constraints are present, combine them using "bool" with "filter" and "must".
- Limit results to 10.
- Only return the JSON for the OpenSearch query body. Do not include explanations or formatting.

Few-shot examples:

Example 1: Spatial only  
User question: "Find all resources within the bounding box near Urbana, IL."
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
                "coordinates": [[-88.25, 40.15], [-88.20, 40.10]]
              },
              "relation": "intersects"
            }
          }
        }
      ]
    }
  }
}

Example 2: Temporal only  
User question: "Show me datasets from 2021."
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        {
          "match": {
            "spatial-index-year": "2021"
          }
        }
      ]
    }
  }
}

Example 3: Spatial + Temporal  
User question: "Find maps from 2020 in Champaign County."
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        {
          "geo_shape": {
            "spatial-geometry-geojson": {
              "shape": {
                "type": "envelope",
                "coordinates": [[-88.45, 40.25], [-88.10, 39.90]]
              },
              "relation": "intersects"
            }
          }
        },
        {
          "match": {
            "spatial-index-year": "2020"
          }
        }
      ],
      "must": [
        {
          "match": {
            "title": "map"
          }
        }
      ]
    }
  }
}

Example 4: Semantic + Spatial  
User question: "Flood risk maps for Chicago area."
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        {
          "geo_shape": {
            "spatial-geometry-geojson": {
              "shape": {
                "type": "envelope",
                "coordinates": [[-87.9401, 41.6445], [-87.5237, 42.0230]]
              },
              "relation": "intersects"
            }
          }
        }
      ],
      "must": [
        {
          "match": {
            "title": "flood risk map"
          }
        }
      ]
    }
  }
}

Example 5: No spatial/temporal constraint  
User question: "List all contributors."
{}
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