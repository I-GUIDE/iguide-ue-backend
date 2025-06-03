/*export function createQueryPayload(model, systemMessage, userMessage, temperature = 0.8, top_p = 0.9, stream = false) {
    return {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      stream,
      temperature:temperature,
      top_p:top_p,
    };
  }*/
    export function createQueryPayload(model, systemMessage, userMessage, temperature = 0.8, top_p = 0.9, stream = false) {
      return {
        //model,
        model:"Qwen/Qwen2.5-7B-Instruct",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
        stream,
      };
    }
  
//   export async function callLlamaModel(queryPayload) {
//   const llamaApiUrl = process.env.ANVILGPT_URL;
//   const anvilGptApiKey = process.env.ANVILGPT_KEY;
//   const controller = new AbortController();
//   const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

//   try {
//     const response = await fetch(llamaApiUrl, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${anvilGptApiKey}`,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify(queryPayload),
//       signal: controller.signal,
//     });

//     clearTimeout(timeout);

//     if (response.ok) {
//       const result = await response.json();
//       return result?.message?.content || null;
//     }

//     const errorText = await response.text();
//     throw new Error(`Error: ${response.status}, ${errorText}`);
//   } catch (error) {
//     console.error("Error fetching from Llama model:", error);
//     throw error;
//   }
// }

export async function callLlamaModel(queryPayload) {
  const proxyUrl = process.env.VLLM_PROXY;
  const proxyToken = process.env.VLLM_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proxyToken}`,
      },
      body: JSON.stringify(queryPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const result = await response.json();
      return result?.choices?.[0]?.message?.content?.trim() || null;
    }

    const errorText = await response.text();
    throw new Error(`Error: ${response.status}, ${errorText}`);
  } catch (error) {
    console.error("Error fetching from proxy server:", error);
    throw error;
  }
}

  
  export async function callGPTModel(queryPayload) {
    const openaiApiKey = process.env.OPENAI_KEY;
    const openaiApiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
  
    try {
      const response = await fetch(openaiApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryPayload),
      });
  
      if (response.ok) {
        const result = await response.json();
        return result?.choices?.[0]?.message?.content || null;
      }
  
      const errorText = await response.text();
      throw new Error(`OpenAI Error: ${response.status}, ${errorText}`);
    } catch (error) {
      console.error("Error fetching from GPT model:", error);
      throw error;
    }
  }
  
  