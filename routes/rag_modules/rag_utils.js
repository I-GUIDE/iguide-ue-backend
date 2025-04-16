// Helper: Format documents for Llama model prompt
export function formatDocs(docs) {
    return docs
      .map(doc => `title: ${doc._source.title}\ntype: ${doc._source["resource-type"]}\ncontributor: ${doc._source.contributor}\nauthors: ${doc._source.authors}\ncontent: ${doc._source.contents}\ntags:${doc._source.tags}`)
      .join("\n\n");
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
