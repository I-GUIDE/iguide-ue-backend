import { callLlamaModel, createQueryPayload } from './llm_modules.js';

export async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  for (const doc of documents) {
    const graderPrompt = `
      Here is the retrieved document: \n\n ${doc._source.contents} \n\n 
      Here is the user question: \n\n ${question}.
      Carefully assess whether the document contains relevant information.
      Return JSON with a single key, binary_score, with value 'yes' or 'no'.
    `;
    const queryPayload = createQueryPayload("llama3.2:latest", "You are a grader assessing the relevance of retrieved documents to a user question.", graderPrompt);
    const result = await callLlamaModel(queryPayload);
    if (result?.message?.content?.toLowerCase().includes('"binary_score": "yes"')) gradedDocuments.push(doc);
  }
  return gradedDocuments;
}

// Function: Grade generation against documents and question
async function gradeGenerationVsDocumentsAndQuestion(state, showReason = false) {
  console.log("---CHECK HALLUCINATIONS---");
  const { question, documents, generation, loop_step = 0 } = state;
  const maxRetries = state.max_retries || 3;

  // Grade for hallucinations
  /*const hallucinationGraderPrompt = `
    FACTS: \n\n ${formatDocs(documents)} \n\n STUDENT ANSWER: ${generation}.
    Ensure the answer is grounded in the facts and does not contain hallucinated information.
    Return JSON with keys binary_score ('yes' or 'no') and explanation.
  `;
  const hallucinationResponse = await callLlamaModel(
    createQueryPayload("llama3.2:latest", "You are a teacher grading a student's answer for factual accuracy.", hallucinationGraderPrompt)
  );

  if (showReason) console.log(hallucinationResponse?.message?.content);
  const hallucinationGrade = hallucinationResponse?.message?.content?.toLowerCase().includes('"binary_score": "yes"') ? "yes" : "no";

  if (hallucinationGrade === "yes") {
    console.log("---DECISION: GENERATION IS GROUNDED IN DOCUMENTS---");

    // Grade for answering the question
    const answerGraderPrompt = `
      QUESTION: \n\n ${question} \n\n STUDENT ANSWER: ${generation}.
      Ensure the answer addresses the question effectively.
      Return JSON with keys binary_score ('yes' or 'no') and explanation.
    `;
    const answerResponse = await callLlamaModel(
      createQueryPayload("llama3.2:latest", "You are a teacher grading a student's answer for relevance.", answerGraderPrompt)
    );

    if (showReason) console.log(answerResponse?.message?.content);
    const answerGrade = answerResponse?.message?.content?.toLowerCase().includes('"binary_score": "yes"') ? "yes" : "no";

    if (answerGrade === "yes") {
      console.log("---DECISION: GENERATION ADDRESSES QUESTION---");
      return "useful";
    } else if (loop_step < maxRetries) {
      console.log("---DECISION: GENERATION DOES NOT ADDRESS QUESTION---");
      return "not useful";
    }
  } else if (loop_step < maxRetries) {
    console.log("---DECISION: GENERATION IS NOT GROUNDED IN DOCUMENTS---");
    return "not supported";
  }
  console.log("---DECISION: MAX RETRIES REACHED---");
  return "max retries";*/
  const graderPrompt = `
    QUESTION: \n\n ${question} \n\n FACTS: \n\n ${formatDocs(documents)} \n\n STUDENT ANSWER: ${generation}.
    Ensure the answer is grounded in the facts and does not contain hallucinated information. Ensure the answer is relevant to the question.
    Return JSON with keys binary_score ('yes' or 'no') and explanation.
  `;
  const hallucinationRelevanceResponse = await callLlamaModel(
    createQueryPayload("llama3.2:latest", "You are a teacher grading a student's answer for factual accuracy and relevance to the question.", graderPrompt)
  );

  if (showReason) console.log(hallucinationRelevanceResponse?.message?.content);
  const grade = hallucinationRelevanceResponse?.message?.content?.toLowerCase().includes('"binary_score": "yes"') ? "yes" : "no";
  //return grade
  if (grade === "yes") {
    return "useful";
  } else if (loop_step < maxRetries) {
    return "not useful";
  }
  return "max retries";
}