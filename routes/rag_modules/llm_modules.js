export function createQueryPayload(model, systemMessage, userMessage, stream = false) {
    return {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      stream,
    };
  }
  
  export async function callLlamaModel(queryPayload) {
    const llamaApiUrl = process.env.ANVILGPT_URL;
    const anvilGptApiKey = process.env.ANVILGPT_KEY;
    try {
      const response = await fetch(llamaApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${anvilGptApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryPayload),
      });
      if (response.ok){
        console.log(response)
        return await response.json();
      }
        
      const errorText = await response.text();
      throw new Error(`Error: ${response.status}, ${errorText}`);
    } catch (error) {
      console.error("Error fetching from Llama model:", error);
      throw error;
    }
  }
  
  