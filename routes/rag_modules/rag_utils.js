// Helper: Format documents for Llama model prompt
export function formatDocsString(docs, k = docs.length) {
  return docs
    .slice(0, k)                                   // ⬅️ keep only the first k hits
    .map(
      doc => `title: ${doc._source.title}
element_type: ${doc._source["resource-type"]}
contributor: ${doc._source.contributor}
authors: ${doc._source.authors}
content: ${doc._source.contents}
tags: ${doc._source.tags}
click_count: ${doc._source.click_count}

`
    )
    .join("\n\n");
}
export function formatDocsJson(docs) {
    // Map each doc to a sanitized object, removing "contents-embedding" and "thumbnail-image"
    const sanitized = docs.map(doc => {
      const {
        "contents-embedding": _omitEmbedding,
        "thumbnail-image": _omitThumbnail,
        ...rest
      } = doc._source;
      return rest;
    });
  
    // Return a stringified JSON array of sanitized docs
    return JSON.stringify(sanitized, null, 2);
  }
  
export function extractJsonFromLLMReturn(response) {
    const match = response.match(/{[\s\S]*?}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        console.error("Invalid JSON:", e);
      }
    } else {
      console.warn("No JSON found");
    }
    return null;
  }
  export function createQueryPayload(model, systemMessage, userMessage, stream = false, temperature = 0.3, top_p = 0.8) {
    return {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      stream,
      temperature,
      top_p,
    };
  }