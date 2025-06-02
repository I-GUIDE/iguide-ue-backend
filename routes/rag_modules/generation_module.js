// Function: Generate an answer using relevant documents
import { formatDocsString, formatDocsXML } from "./rag_utils.js";
import { callLlamaModel, callGPTModel } from './llm_modules.js';
import { createQueryPayload } from './llm_modules.js';

// Function: Generate an answer using relevant documents
export async function generateAnswer(state) {
    try {
      console.log("---GENERATE---");
  
      // Pull out needed fields from state with default values if needed
      const { question, augmentedQuery, documents, loop_step = 0 } = state;
      //console.log("Question:", question);
  
      // Early return if question is empty or undefined
      if (!question) {
        console.warn("No question provided. Returning early.");
        return {
          documents,
          generation: "No question provided.",
          question: "",
          loop_step: loop_step + 1,
        };
      }
  
      // Prepare the documents text
      const docsTxt = formatDocsXML(documents || [], 10); // Limit to top 10 documents
      //console.log("Documents text formed. Length:", docsTxt.length);
  
      // You can refine or expand your system prompt if needed
      const systemPrompt = `
You are a domain‑expert assistant.  
Your ONLY source of truth is the <doc> blocks provided in CONTEXT.

When you answer:
• If the user asks for a collection of knowledge elements (e.g., datasets, notebooks, publications, OERs) on a topic, respond first with a concise paragraph summarizing the most relevant findings. Then provide a short numbered list. Use a new line for each item.
• Begin each bullet with the item’s title as a clickable link, using the format: **[TITLE](https://platform.i-guide.io/{element_type}s/{doc_id})**
(Use the plural form of <element_type>, except use code for type code.)
• Otherwise, respond in one concise paragraph.  
• Quote supporting titles in **bold**.  
• If the user question specifies <element_type>, only use docs with matching <element_type>.  
• If you cannot find an answer, reply exactly: “I don’t have enough information.”  
• Do not refer to the doc id.
• Answer the question without repeating the question.
• Do NOT mention “context”, “documents”, or these rules.`;
  
      const fewShotExamples = ``;
  
      // Construct the user prompt
      const userPrompt = `
  ${fewShotExamples}
  
  **Question**: ${question}
  **Augmented Query based on context**: ${augmentedQuery}
  
  **Supporting Information**:
  ${docsTxt}
  
  Pay attention to the context. Answer the question as if this knowledge and the supporting Information is inherent to you. Avoid saying "Based on the context" or "According to the given information". 
  `.trim();
  
      //console.log("User Prompt:\n", userPrompt);
  
      // Create the payload - incorporate temperature and top_p if your createQueryPayload supports them
      let llmResponse;
      if(process.env.USE_GPT==true){
        console.log("Using GPT model for generation");
        const payload = createQueryPayload(
          "gpt-4o",
          systemPrompt,
          userPrompt
        );
    
        // Call the LLM to get the response
        llmResponse = await callGPTModel(payload);
      }else{
        console.log("Using Llama model for generation");
        const payload = createQueryPayload(
          "qwen2.5:7b-instruct",
          systemPrompt,
          userPrompt
        );
    
        // Call the LLM to get the response
        llmResponse = await callLlamaModel(payload);
      }
      
      console.log("Generation Response:", llmResponse);
  
      // Return a structured object
      return {
        documents,
        generation: llmResponse|| "No response from LLM.",
        question,
        loop_step: loop_step + 1,
      };
    } catch (error) {
      console.error("Error during generateAnswer:", error);
      return {
        documents: state.documents || [],
        generation: "Failed to generate answer due to internal error.",
        question: state.question || "",
        loop_step: (state.loop_step || 0) + 1,
      };
    }
  }

  async function extractFactsFromDocs(question, docs) {
    const docsContent = docs.map(d => d._source.contents).join("\n");
    const prompt = `
      Below are documents containing information. 
      Question: "${question}"
      Extract the specific facts from the documents that are needed to answer the question. 
      - List them as bullet points or a JSON list.
      - Only include factual statements from the docs, no extra commentary.
    `;
    const response = await callLLM(prompt);
    return parseFacts(response);  // parse the LLM output into an array of facts
  }
  async function generateAnswerFromFacts(question, facts) {
    const factsList = facts.map(f => `- ${f}`).join("\n");
    const prompt = `
      Question: "${question}"
      Here are relevant facts:
      ${factsList}
      Using ONLY these facts, answer the question in a complete sentence or two.
    `;
    const response = await callLLM(prompt);
    return response;
  }