import os
from openai import OpenAI

HF_TOKEN = "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"
API_BASE_URL = "https://api.groq.com/openai/v1"
MODEL_NAME = "llama-3.3-70b-versatile"

client = OpenAI(
    api_key=HF_TOKEN,
    base_url=API_BASE_URL,
)

try:
    resp = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": "Say 'Connection Success'"}],
        max_tokens=10
    )
    print(resp.choices[0].message.content.strip())
except Exception as e:
    print(f"Connection Failed: {e}")
