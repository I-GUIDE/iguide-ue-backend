import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLlamaModel, createQueryPayload } from './llm_modules.js';
// For ES modules, resolve __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let schemaCache = null;
let lastSchemaFetchTime = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Load .env from ../../.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
let neo4j_server = process.env.NEO4J_CONNECTION_STRING;
if(process.env.NEO4J_FORCE_PROD=="true"){
    neo4j_server = process.env.NEO4J_CONNECTION_STRING_PROD;
}
const driver = neo4j.driver(
    neo4j_server,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
  );
export async function getComprehensiveSchema(forceRefresh = false) {
    const now = Date.now();
    const isExpired = !lastSchemaFetchTime || (now - lastSchemaFetchTime > CACHE_TTL_MS);
  
    if (!forceRefresh && schemaCache && !isExpired) {
      console.log("Neo4j Agent: Returning cached schema");
      return schemaCache;
    }
  
    console.log("Neo4j Agent: Fetching fresh schema from Neo4j...");
    const session = driver.session({
      database: process.env.NEO4J_DB,
      defaultAccessMode: neo4j.session.READ
    });
  
    try {
      const schema = {
        nodeLabels: [],
        relationshipTypes: [],
        nodeSchemas: {},
      };
  
      const labelResult = await session.run("CALL db.labels()");
      schema.nodeLabels = labelResult.records.map(r => r.get(0));
  
      const relResult = await session.run("CALL db.relationshipTypes()");
      schema.relationshipTypes = relResult.records.map(r => r.get(0));
  
      for (const label of schema.nodeLabels) {
        const result = await session.run(
          `MATCH (n:\`${label}\`) RETURN keys(n) AS props, n LIMIT 1`
        );
  
        if (result.records.length > 0) {
          const props = result.records[0].get('props');
          const sampleNode = result.records[0].get('n').properties;
  
          schema.nodeSchemas[label] = { properties: props, sample: sampleNode };
        } else {
          schema.nodeSchemas[label] = { properties: [], sample: {} };
        }
      }
  
      const relSample = await session.run("CALL db.schema.visualization()");
      schema.relationshipSamples = relSample.records.map(record => {
        const source = record.get('nodes')[0].labels[0];
        const target = record.get('nodes')[1].labels[0];
        const type = record.get('relationships')[0].type;
        return { source, target, type };
      });
  
      // Cache it
      schemaCache = schema;
      lastSchemaFetchTime = Date.now();
  
      return schema;
    } catch (err) {
      console.error("Neo4j Agent: Error building schema:", err);
      return {};
    } finally {
      await session.close();
    }
  }

export async function generateCypherQueryFromSchema(question, schema) {
    const systemPrompt = `
  You are a Cypher expert with access to the following Neo4j graph database schema:
  Nodes and properties:
  ${Object.entries(schema.nodeSchemas).map(([label, { properties }]) => `- ${label}: ${properties.join(", ")}`).join("\n")}
  
  Relationships between node types:
  ${schema.relationshipSamples.map(rel => `- (${rel.source})-[:${rel.type}]->(${rel.target})`).join("\n")}
  
  You will receive a user question. 
  Remember: 
  1. Knowledge element refers to all nodes except for Contributor nodes.
  2. Popularity is determined by the number of counts.
  3. Connections between nodes are defined by the relationships in the schema.
  4. Limit the results to 10 if the query does not specify.
  5. When generating a Cypher query involving sorting, always use "coalesce(n.property, 0)" to safely handle missing values and sort properly.
  Your job is to generate a valid Cypher query that can be used to answer it using the schema above.
  Only return the Cypher query. Do not include explanations or formatting.
  If the question cannot be answered with this schema, return: "/* Insufficient information to generate Cypher query */"
  Only return Cypher queries that return results in the format:

RETURN {
  _id: n.id,
  _score: 1.0,
  click_count: n.click_count,
  contributor: c { .id, name: c.first_name + ' ' + c.last_name, .avatar_url },
  contents: n.contents,
  \`resource-type\`: TOLOWER(LABELS(n)[0]),
  title: n.title,
  authors: n.authors,
  tags: n.tags,
  \`thumbnail-image\`: n.thumbnail_image
} AS doc
 Only return Cypher. Do NOT use id(n), ID(n), or n.click_count as _id.
Contributor information must be retrieved via an OPTIONAL MATCH: (c:Contributor)-[:CONTRIBUTED]-(n)
  `.trim();
  
    const userPrompt = `User question: ${question}`;
  
    const payload = createQueryPayload(
        "qwen2.5:7b-instruct",
        systemPrompt,
        userPrompt
      );
      
      // Now add parameters
      payload.temperature = 0.1;
      payload.top_p = 0.8;
      
      const response = await callLlamaModel(payload);
    const query = response?.trim();
  
    //console.log("Generated Cypher Query:\n", query);
    return query;
  }


  export async function runCypherQuery(query) {
    const session = driver.session({
      database: process.env.NEO4J_DB,
      defaultAccessMode: neo4j.session.READ
    });
  
    try {
      const result = await session.run(query);
      return result.records.slice(0, 10).map(record => {
        const doc = record.get('doc');
        return {
          _id: doc._id,
          _score: doc._score,
          click_count: doc.click_count,
          contributor: doc.contributor,
          contents: doc.contents,
          "resource-type": doc["resource-type"],
          title: doc.title,
          authors: doc.authors || [],
          tags: doc.tags || [],
          "thumbnail-image": doc["thumbnail-image"],
        };
      });
    } catch (error) {
      console.error("Cypher execution failed:", error);
      return [];
    } finally {
      await session.close();
    }
  }
export async function agentSearchWithLLM(question, schema) {
    const cypherQuery = await generateCypherQueryFromSchema(question, schema);
  
    if (cypherQuery.includes("/* Insufficient information")) {
      return {
        generation: "Sorry, I can't answer this with the current schema.",
        results: [],
      };
    }
    // Run the generated Cypher query
    console.log("Neo4j Agent: Generated Cypher Query:\n", cypherQuery);
    const results = await runCypherQuery(cypherQuery);
    return {
      generation: `Query: ${cypherQuery}`,
      results,
    };
  }
  
  