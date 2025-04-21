import JSON5 from 'json5';
// Helper: Format documents for Llama model prompt
export function formatDocsString(docs, k = docs.length) {
  return docs
    .slice(0, k)                                   // ⬅️ keep only the first k hits
    .map(
      doc => `title: ${doc._source.title}
type: ${doc._source["resource-type"]}
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

  function stripCodeFence(str) {
    return str.replace(/```(?:json)?|```/gi, "").trim();
  }
  
  function normaliseQuotes(str) {
    return str.replace(/[“”‘’]/g, '"');
  }
  
  // Attempt to remove a single trailing comma before } or ]
  function removeTrailingComma(str) {
    return str.replace(/,(\s*[}\]])/g, '$1');
  }
  
  export function safeParseLLMJson(raw) {
    if (!raw) return null;
  
    // ── Helpers
    const stripFence = t => t.replace(/^```(?:json)?/i, '').replace(/```$/, '');
    const normQuotes = t => t.replace(/[“”]/g, '"');
    const noTrailing = t => t.replace(/,\s*([}\]])/g, '$1');
    const quoteBare = t => t.replace(/:\s*([A-Za-z_][^",}\]\n\r]*)/g,
                                     (_, g) => `: "${g.trim()}"`);
    const deleteNewlinesInsideStrings = t =>
      t.replace(/"([^"\\]*(\\.[^"\\]*)*)"/gs, m => m.replace(/[\n\r]+/g, ' '));
  
    // ── Pre‑sanitize
    let txt = noTrailing(normQuotes(stripFence(raw)).trim());
  
    // ── Prefer block that starts with {"action"
    const cand = selectBalancedBlockRE(txt, /\{\s*"action"\s*:/) ||
                   selectBalancedBlock(txt, '{');
    if (!cand) return null;
  
    // ── Repairs in order
    const attempts = [
      cand,
      quoteBare(cand),
      deleteNewlinesInsideStrings(cand),
      deleteNewlinesInsideStrings(quoteBare(cand))
    ];
  
    for (const s of attempts) {
      try { return JSON.parse(s);       } catch {}
      try { return JSON5.parse(s);      } catch {}
    }
    console.warn('safeParseLLMJson failed on all repairs');
    return null;
  
/* return the first balanced { … } that matches a regex right after '{' */
function selectBalancedBlockRE(str, regex) {
  const m = str.match(regex);
  if (!m) return null;
  return selectBalancedBlock(str, m.index);   // reuse depth counter below
}

/* existing depth‑counter, but index param instead of token --------------- */
function selectBalancedBlock(str, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0)
      return str.slice(startIdx, i + 1);
  }
  return null;                               // unbalanced
}

async function autoExtractFacts(question, docs, known = {}) {
    const facts = { ...known };                    // start with existing
  
    // 1‑A  structured harvest  ────────────────────────────────────────────────
    docs.forEach(d => {
      const src = d._source || {};
      if (Array.isArray(src.authors) && src.authors.length) {
        // store *first* author if not known
        if (!facts.author) facts.author = src.authors[0];
      }
      if (src.title && !facts.title) facts.title = src.title;
      if (typeof src.year === 'number' && !facts.year) facts.year = String(src.year);
      if (typeof src['click_count'] === 'number' && !facts.click_count) {
        facts.click_count = String(src.click_count);
      }
      // Add more field mappings here if you want (e.g., bbox, dataset_id …)
    });
  
    // If we already filled something new, no need to call the LLM
    const hasNew = Object.keys(facts).some(k => !(k in known));
    if (hasNew) return Object.fromEntries(
      Object.entries(facts).filter(([k,v]) => !(k in known))  // only *new* ones
    );
  
    // 1‑B  fallback LLM extractor  ────────────────────────────────────────────
    if (docs.length === 0) return {};
    const sys = "Extract concrete facts (names, numbers, IDs, percentages…) helpful for answering the question.";
    const user = `Question: "${question}"
  Known facts: ${JSON.stringify(known)}
  Snippet:
  """${docs[0]._source.contents.slice(0, 400)}"""
  Return ONLY a JSON object of new facts.`;
    try {
      const txt = await callLlamaModel(createQueryPayload("llama3:instruct", sys, user));
      const extracted = safeParseLLMJson(txt);
      // remove keys that duplicate existing facts
      Object.keys(extracted).forEach(k => { if (k in known) delete extracted[k]; });
      return extracted;
    } catch { return {}; }
  }}