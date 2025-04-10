import { callLlamaModel, createQueryPayload } from './llm_modules.js';

/*export async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  for (const doc of documents) {
    const graderPrompt = `
      Here is the retrieved document: \n\n ${doc._source.contents} \n\n Here is the user question: \n\n ${question}.
      Carefully assess whether the document contains relevant information.
      Return JSON with a single key, binary_score, with value 'yes' or 'no'.
    `;

    const queryPayload = createQueryPayload(
      "llama3.2:latest",
      "You are a grader assessing the relevance of retrieved documents to a user question.",
      graderPrompt
    );

    const result = await callLlamaModel(queryPayload);

    if (result?.message?.content?.toLowerCase().includes('"binary_score": "yes"')) {
      console.log("---GRADE: DOCUMENT RELEVANT---");
      gradedDocuments.push(doc);
    } else {
      console.log("---GRADE: DOCUMENT NOT RELEVANT---");
    }
  }

  return gradedDocuments;
}*/
export async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  for (const doc of documents) {
    const graderPrompt = `
      You are a grader assessing the relevance of the following document to a user question.
      You must return a JSON object with one key: "relevance_score", a numeric value between 0 and 10,
      where 0 means completely irrelevant, 10 means highly relevant.

      Document contents:
      ${doc._source.contents}

      User question:
      ${question}

      Return the result strictly in JSON format:
      {"relevance_score": <numeric_score>}
    `;

    // Create your query payload (adjust the model & system prompt as needed)
    const queryPayload = createQueryPayload(
      "llama3.2:latest",
      "You are a grader assessing document relevance. Return a single JSON object with a numeric relevance_score.",
      graderPrompt
    );

    // Call the LLM
    const result = await callLlamaModel(queryPayload);

    // Attempt to parse the JSON response
    try {
      const parsed = JSON.parse(result?.message?.content.trim());
      const relevanceScore = parsed?.relevance_score;

      if (typeof relevanceScore === 'number') {
        console.log(`---GRADE: Document scored ${relevanceScore}---`);
        doc._score = relevanceScore;
        if (relevanceScore > 0) {
          //console.log("---GRADE: DOCUMENT RELEVANT---");
          gradedDocuments.push(doc);
        }
        
      } else {
        console.log("---GRADE ERROR: Missing or invalid relevance_score---");
      }
    } catch (err) {
      console.log("---GRADE ERROR: Could not parse JSON---", err);
    }
  }

  // Sort the documents by descending relevance score
  gradedDocuments.sort((a, b) => b._score - a._score);
  return gradedDocuments;
}

/*export async function gradeDocuments(documents, question) {
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  const graderPrompt = `
    You are a grader assessing the relevance of multiple retrieved documents to a user question.\n\n
    Here is the user question: \n\n ${question} \n\n
    Here are the retrieved documents:
    ${documents
      .map(
        (doc, index) => `Document ${index + 1}: \n\n ${doc._source.contents} \n\n`
      )
      .join("")}
    Carefully assess whether each document contains relevant information. 
    Only return JSON with the results in the following format:
      {
        "results": [
          {"document_index": 1, "binary_score": "yes"},
          {"document_index": 2, "binary_score": "no"},
          ...
        ]
      }
    Only include "yes" or "no" for the binary_score value, no other text.
  `;

  const queryPayload = createQueryPayload(
    "llama3.2:latest",
    "You are a grader assessing the relevance of retrieved documents to a user question.",
    graderPrompt
  );

  const result = await callLlamaModel(queryPayload);

  const gradedDocuments = [];
  // Extract JSON if the LLM response is not clean
  try {
    const responseContent = result?.message?.content || "";

    // Use regex to extract a JSON block from the response
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsedResults = JSON.parse(jsonMatch[0]);

    if (Array.isArray(parsedResults.results)) {
      parsedResults.results.forEach((res) => {
        if (res.binary_score === "yes") {
          const relevantDoc = documents[res.document_index - 1]; // Convert 1-based to 0-based index
          if (relevantDoc) {
            gradedDocuments.push(relevantDoc);
            console.log(`---GRADE: DOCUMENT ${res.document_index} RELEVANT---`);
          }
        } else {
          console.log(`---GRADE: DOCUMENT ${res.document_index} NOT RELEVANT---`);
        }
      });
    }
  } catch (error) {
    console.error("Error parsing LLM response:", error, result?.message?.content);
  }

  return gradedDocuments;
}*/


// Function: Grade generation against documents and question
export async function gradeGenerationVsDocumentsAndQuestion(state, showReason = false) {
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
function formatDocs(docs) {
  return docs
    .map(doc => `title: ${doc._source.title}\ncontent: ${doc._source.contents}\ncontributor: ${doc._source.contributor}`)
    .join("\n\n");
}