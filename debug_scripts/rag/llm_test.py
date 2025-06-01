import requests
import time

payload = {
    "model": "qwen2.5:7b-instruct",
    "messages": [
        {
            "role": "system",
            "content": """Task: Expand the new query ONLY if it directly refers to the previous conversation. Return the original query if it's unrelated.
Rules:
1. Augment ONLY if the new query explicitly references previous questions (e.g., uses "these", "those", "any", or implies continuation)
2. Never combine with older context if the query introduces a new topic
3. Keep augmented queries concise (under 12 words)
4. Respond ONLY with the final query - no explanations
5. Do not include the terms that are not related to the context

Examples:
Previous: Chicago datasets
New: Any about social media?
Output: Chicago datasets related to social media

Previous: Chicago datasets
New: Show climate data
Output: Climate data

Previous: Chicago datasets
New: What is telecoupling?
Output: What is telecoupling?
"""
        },
        {
            "role": "user",
            "content": 'Previous Questions (most recent first):\n    - Chicago datasets\n\n    New Query: "Chicago datasets"'
        }
    ],
    "stream": False
}

start = time.time()
response = requests.post(
    "https://anvilgpt.rcac.purdue.edu/ollama/api/chat",
    headers={
        "Authorization": "Bearer sk-c4518929422e46aa9e2515e1d2117fa2",
        "Content-Type": "application/json"
    },
    json=payload,
    timeout=90
)

print("Status:", response.status_code)
print("Time taken:", time.time() - start, "seconds")
print(response.text)