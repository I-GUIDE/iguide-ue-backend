import { callLlamaModel, createQueryPayload } from './llmModule';

export async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  for (const doc of documents) {
    const graderPrompt = `
      Here is the retrieved document: \n\n ${doc._source.contents} \n\n 
      Here is the user question: \n\n ${question}.
      Carefully assess whether the document contains relevant information.
      Return JSON with a single key, binary_score, with value 'yes' or 'no'.
    `;
    const queryPayload = createQueryPayload("llama3.2:latest", "You are a grader assessing relevance.", graderPrompt);
    const result = await callLlamaModel(queryPayload);
    if (result?.message?.content?.toLowerCase().includes('"binary_score": "yes"')) gradedDocuments.push(doc);
  }
  return gradedDocuments;
}

export async function gradeGenerationVsDocumentsAndQuestion(state, showReason = false) {
  const { question, documents, generation, loop_step = 0 } = state;
  const hallucinationPrompt = `
    FACTS: \n\n ${documents.map(doc => doc._source.contents).join('\n')}\n\n 
    STUDENT ANSWER: ${generation}.
    Return JSON with keys binary_score ('yes' or 'no') and explanation.
  `;
  const hallucinationResponse = await callLlamaModel(
    createQueryPayload("llama3.2:latest", "You are a teacher grading a student's answer.", hallucinationPrompt)
  );
  return hallucinationResponse;
}
