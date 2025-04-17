// Function: Generate an answer using relevant documents
import { formatDocsString } from "./rag_utils.js";
import { callLlamaModel, callGPTModel } from './llm_modules.js';
import { createQueryPayload } from './llm_modules.js';

// Function: Generate an answer using relevant documents
export async function generateAnswer(state) {
    try {
      console.log("---GENERATE---");
  
      // Pull out needed fields from state with default values if needed
      const { question, augmentedQuery, documents, loop_step = 0 } = state;
      console.log("Question:", question);
  
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
      const docsTxt = formatDocsString(documents || [], 3); // Limit to top 5 documents
      //console.log("Documents text formed. Length:", docsTxt.length);
  
      // You can refine or expand your system prompt if needed
      const systemPrompt = `You are an AI assistant that uses the provided context to answer queries accurately.
  You should not invent details if not found in the context. 
  If there's insufficient information, say so.`;
  
      // If you have any few-shot examples, they can be appended here
      const fewShotExamples = ``;
  
      // Construct the user prompt
      const userPrompt = `
  ${fewShotExamples}
  
  **Question**: ${question}
  **Augmented Query based on context**: ${augmentedQuery}
  
  **Supporting Information**:
  ${docsTxt}
  
  Answer the question while paying attention to the context as if this knowledge is inherent to you. Justify the answer by referencing the supporting information.
      `.trim();
  
      //console.log("User Prompt:\n", userPrompt);
  
      // Create the payload - incorporate temperature and top_p if your createQueryPayload supports them
      let llmResponse;
      if(process.env.USE_GPT==true){
        const payload = createQueryPayload(
          "gpt-4o",
          systemPrompt,
          userPrompt
        );
    
        // Call the LLM to get the response
        llmResponse = await callGPTModel(payload);
      }else{
        const payload = createQueryPayload(
          "llama3:instruct",
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