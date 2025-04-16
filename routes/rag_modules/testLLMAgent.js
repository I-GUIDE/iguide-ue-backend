import { getComprehensiveSchema } from './neo4j_agent.js'; // Your schema extraction function
import { agentSearchWithLLM } from './neo4j_agent.js';            // Your combined agent logic

async function testLLMAgent() {
  const schema = await getComprehensiveSchema();
    
  const question = "What are the most popular knowledge elements";

  const result = await agentSearchWithLLM(question, schema);

  console.log("=== LLM Agent Output ===");
  console.log("Generated Cypher Query:\n", result.generation);
  console.log("Query Results:\n", result.results);
  //console.log(JSON.stringify(schema.nodeSchemas, null, 2));
  console.log("Generated Cypher Query:\n", result.generation);
}

testLLMAgent();
