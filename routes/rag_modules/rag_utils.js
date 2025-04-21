import rateLimit from 'express-rate-limit';

/**
 * Factory: create a per‑user limiter.
 * @param {number} maxPerHour  – allowed calls per user every rolling hour
 * @returns {import('express').RequestHandler}
 */
export function makeSearchRateLimiter(maxPerHour = 10) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,          // 1 hour
    max: maxPerHour,                   // ← runtime parameter
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => req.user?.id || req.ip,
    handler: (req, res) => {
      applyRateLimiterCorsHeaders(req, res);   
      res.status(429);
      res.write('event: error\n');
      res.write(
        `data: {"error":"Rate limit exceeded – ${maxPerHour} searches per hour allowed."}\n\n`
      );
      res.end();
    },
  });
}
export function applyRateLimiterCorsHeaders(req, res) {
  const allowedOrigins = process.env.ALLOWED_DOMAIN_LIST ? JSON.parse(process.env.ALLOWED_DOMAIN_LIST) : [`${process.env.FRONTEND_DOMAIN}`]
  res.header('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
    if (allowedOrigins.length > 1) {
        const origin = req.headers.origin;
        if (!origin || allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        } else {
            res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
        }
    } else {
        res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
}
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
export function formatDocsXML(docs, k = docs.length) {
  return docs
    .slice(0, k)                              // keep only the first k hits  :contentReference[oaicite:0]{index=0}
    .map((doc, idx) => `
<doc id="${idx + 1}">
  <title>${(doc._source.title)}</title>
  <element_type>${(doc._source["resource-type"])}</element_type>
  <contributor>${(doc._source.contributor)}</contributor>
  <authors>${(doc._source.authors)}</authors>
  <content>${(doc._source.contents)}</content>
  <tags>${(doc._source.tags)}</tags>
  <click_count>${doc._source.click_count ?? 0}</click_count>
</doc>`)
    .join("\n");                              // merge blocks with newlines  :contentReference[oaicite:1]{index=1}
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