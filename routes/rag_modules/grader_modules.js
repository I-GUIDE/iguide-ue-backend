import { callLlamaModel, createQueryPayload, callGPTModel } from './llm_modules.js';
import { extractJsonFromLLMReturn, formatDocsString, formatDocsJson } from './rag_utils.js';

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
/*function extractJsonFromLLMReturn(response) {
  // First, try direct parse:
  try {
    return JSON.parse(response.trim());
  } catch (directParseError) {
    // Fallback: parse substring between [ and ]
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        console.error("Failed to parse JSON array substring:", e);
      }
    }
  }
  console.warn("Could not find valid JSON in response");
  return null;
}*/
export async function gradeDocuments(documents, question) {
  const gradedDocuments = [];
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  for (const doc of documents) {
    // 1) Remove "contents-embedding" (and anything else unnecessary)
    // This uses destructuring to "pull out" the key and discard it
    const { 
      "contents-embedding": _embeddings,  // discard
      ...docWithoutEmbedding 
    } = doc._source;

    // 2) Build a simpler, consistent schema for the grader
    //    (you can rename or reorder fields as you wish)
    const docForGrading = {
      title: docWithoutEmbedding.title || "",
      resourceType: docWithoutEmbedding["resource-type"] || "",
      authors: docWithoutEmbedding.authors || [],
      tags: docWithoutEmbedding.tags || [],
      contributor: docWithoutEmbedding.contributor || "",
      contents: docWithoutEmbedding.contents || ""
      // Add or remove fields as needed
    };

    // Convert the simplified doc to JSON or a string for the prompt
    const docString = JSON.stringify(docForGrading, null, 2);

    // 3) Build your grader prompt with the simplified doc
    const graderPrompt = `
      You are a grader assessing the relevance of the following knowledge element to a user question.
      The knowledge element has the following fields in JSON format:

      ${docString}

      The user question is: ${question}

      Please return a JSON object with a single key: "relevance_score".
      The value must be an integer from 0 to 10, where 0 = completely irrelevant, 10 = highly relevant.
      If the user asked for a specific knowledge element type, such as "notebook", "dataset", give the knowledge element a score of 0.
      For example:
      {"relevance_score": 7}
    `;

    // 4) Create your query payload (adjust system prompt as needed)
    let result
    if(process.env.USE_GPT==true){
      const queryPayload = createQueryPayload(
        "gpt-4o-mini",
        "You are a grader assessing document relevance. Return a single JSON object with a numeric relevance_score.",
        graderPrompt
      );
      result = await callGPTModel(queryPayload);
    }else{
      const queryPayload = createQueryPayload(
        "qwen2.5:7b-instruct",
        "You are a grader assessing document relevance. Return a single JSON object with a numeric relevance_score.",
        graderPrompt,
        0.0,
        1.0
      );
      result = await callLlamaModel(queryPayload);
    }
    

    // 6) Parse LLM response as JSON
    try {
      const parsed = extractJsonFromLLMReturn(result.trim());
      const relevanceScore = parsed?.relevance_score;

      if (typeof relevanceScore === 'number') {
        console.log(`---GRADE: Document scored ${relevanceScore}---`);
        doc._score = relevanceScore;
        if (relevanceScore > 0) {
          gradedDocuments.push(doc);
        }
      } else {
        console.warn("---GRADE ERROR: Missing or invalid relevance_score---");
      }
    } catch (err) {
      console.error("---GRADE ERROR: Could not parse JSON---", err);
    }
  }

  return gradedDocuments;
}

/*export async function gradeDocuments(documents, question) {
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION (all at once)---");

  // Build a string listing each document with an ID
  const docList = documents
    .map((doc, index) => `Document #${index + 1}:\n${doc._source.contents}`)
    .join("\n\n");

  // Single prompt with all docs
  const graderPrompt = `
    You are a grader assessing the relevance of multiple documents to a user question.
    For each document, assign a relevance score between 0 and 10, where 0 means completely irrelevant, 
    and 10 means highly relevant.

    Here are the documents (each has an ID before the text):
    ${docList}

    User question:
    ${question}

    Return the results strictly as a JSON array of objects. 
    Each object must have two keys: "doc_id" (integer) and "relevance_score" (numeric).
    Example format:
    [
      {"doc_id": 1, "relevance_score": 7},
      {"doc_id": 2, "relevance_score": 0},
      ...
    ]
  `;

  // Create your query payload (adjust the model & system prompt as needed)
  const queryPayload = createQueryPayload(
    "llama3:instruct",
    "You are a grader assessing document relevance. Return a JSON array of { doc_id, relevance_score } objects.",
    graderPrompt
  );

  // Call the LLM once
  const result = await callLlamaModel(queryPayload);
  let gradedDocuments = [];

  try {
    // Attempt to parse LLM response as JSON
    const parsedResults = extractJsonFromLLMReturn(result?.message?.content.trim());
    if (Array.isArray(parsedResults)) {
      for (const item of parsedResults) {
        // doc_id in LLM is 1-based; adjust if needed
        const docIndex = (item.doc_id || 0) - 1;

        // Validate docIndex is in range
        if (docIndex >= 0 && docIndex < documents.length) {
          const relevanceScore = item.relevance_score;
          console.log(`---GRADE: Document #${docIndex + 1} scored ${relevanceScore}---`);

          // Store the score on the original document object
          documents[docIndex]._score = relevanceScore;

          // Example filter: only keep docs with relevance > 0
          if (relevanceScore > 0) {
            gradedDocuments.push(documents[docIndex]);
          }
        }
      }
    } else {
      console.log("---GRADE ERROR: Returned JSON is not an array---");
    }
  } catch (err) {
    console.log("---GRADE ERROR: Could not parse JSON---", err);
    console.log("---LLM RESPONSE---", result?.message?.content);
  }

  return gradedDocuments;
}*/


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
export async function gradeGenerationVsDocumentsAndQuestion(state, showReason = true) {
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
You are an exacting examiner.  
Read the QUESTION, the FACTS (your **only** source of truth), and the student ANSWER.

RULES
1. **No outside knowledge** — every claim in the ANSWER must be *explicitly* supported by the FACTS section.  
2. If the FACTS section is empty, or any claim is unsupported/contradicted, the answer is hallucinated ⇒ score "no".  
3. The ANSWER must directly address the QUESTION; otherwise score "no".  
4. Ignore style or grammar; grade only factual grounding and relevance.

OUTPUT (JSON only)
{
  "binary_score": "yes" | "no",    // "yes" = completely fact-grounded **and** relevant
  "explanation": "<1-2 concise sentences justifying the score>"
}

Return exactly this JSON object and nothing else.
QUESTION:

${question}

FACTS:
${formatDocsString(documents)}

ANSWER:
${generation}
`;

  const hallucinationRelevanceResponse = await callLlamaModel(
    createQueryPayload("qwen2.5:7b-instruct", "You are a teacher grading a student's answer for factual accuracy and relevance to the question.", graderPrompt)
  );
  console.log("Grader prompt: ", graderPrompt);
  if (showReason) console.log(hallucinationRelevanceResponse);
  const grade = hallucinationRelevanceResponse?.toLowerCase().includes('"binary_score": "yes"') ? "yes" : "no";
  //return grade
  if (grade === "yes") {
    return "useful";
  } else if (loop_step < maxRetries) {
    return "not useful";
  }
  return "max retries";
}
export async function addAndGradeDocuments(relevantDocuments, newDocuments, question) {
  // We'll store newly-graded documents here
  const newlyGraded = [];
  console.log("---CHECK DOCUMENT RELEVANCE TO QUESTION---");

  for (const doc of newDocuments) {
    // 1) Remove fields you don't need, like embeddings
    const {
      "contents-embedding": _embeddings, // discard
      ...docWithoutEmbedding
    } = doc._source;

    // 2) Build a simpler, consistent schema for the grader
    const docForGrading = {
      title: docWithoutEmbedding.title || "",
      resourceType: docWithoutEmbedding["resource-type"] || "",
      authors: docWithoutEmbedding.authors || [],
      tags: docWithoutEmbedding.tags || [],
      contributor: docWithoutEmbedding.contributor || "",
      contents: docWithoutEmbedding.contents || "",
      // or any other fields you need
    };

    // Convert the simplified doc to JSON or a string for the prompt
    const docString = JSON.stringify(docForGrading, null, 2);

    // 3) Build your grader prompt
    const graderPrompt = `
      You are a grader assessing the relevance of the following document to a user question.
      The document has the following fields in JSON format:

      ${docString}

      The user question is: ${question}

      Please return a JSON object with a single key: "relevance_score".
      The value must be an integer from 0 to 10, where 0 = completely irrelevant, 10 = highly relevant.

      For example:
      {"relevance_score": 7}
    `;

    // 4) Create your query payload (adjust system prompt as needed)
    const queryPayload = createQueryPayload(
      "qwen2.5:7b-instruct",
      "You are a grader assessing document relevance. Return a single JSON object with a numeric relevance_score.",
      graderPrompt
    );

    // 5) Call the LLM
    const result = await callLlamaModel(queryPayload);

    // 6) Parse LLM response as JSON
    try {
      const parsed = extractJsonFromLLMReturn(result?.trim());
      const relevanceScore = parsed?.relevance_score;

      if (typeof relevanceScore === "number") {
        console.log(`---GRADE: Document scored ${relevanceScore}---`);
        // Attach the score directly to the doc
        doc._score = relevanceScore;
        // Keep doc in newlyGraded only if it has a score > 0
        if (relevanceScore > 0) {
          newlyGraded.push(doc);
        }
      } else {
        console.warn("---GRADE ERROR: Missing or invalid relevance_score---");
      }
    } catch (err) {
      console.error("---GRADE ERROR: Could not parse JSON---", err);
    }
  }

  // Merge newly graded documents with existing relevantDocuments
  // We'll keep them in one array, then remove duplicates by _id
  const allDocuments = [...relevantDocuments, ...newlyGraded];

  // 7) Remove duplicates by _id (adapt if your docs have a different unique key)
  const uniqueDocsMap = new Map();
  for (const doc of allDocuments) {
    uniqueDocsMap.set(doc._id, doc);
  }
  // Convert Map back to an array
  const deduplicatedDocs = Array.from(uniqueDocsMap.values());

  // 8) Sort in descending order by _score
  deduplicatedDocs.sort((a, b) => b._score - a._score);

  // 9) Keep top 10
  const topDocs = deduplicatedDocs.slice(0, 10);

  // Return them — this becomes your updated relevantDocuments
  return topDocs;
}