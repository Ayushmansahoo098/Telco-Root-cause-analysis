#!/bin/bash
URL="https://ayushman098-telco-rca.hf.space"
echo "Waiting for Hugging Face Space to build and start at $URL..."
for i in {1..20}; do
  if curl -sf $URL/health > /dev/null; then
    echo "Space is live!"
    break
  fi
  echo "Attempt $i: Not ready yet, sleeping 15s..."
  sleep 15
done

echo "Fetching /health..."
HEALTH=$(curl -s $URL/health)
echo "Fetching /tasks..."
TASKS=$(curl -s $URL/tasks)

cat <<OUT > artifacts/hf_live_check.txt
=== Hugging Face Live Deploy Check ===
Date: $(date)
Public URL: $URL
Dashboard URL: https://huggingface.co/spaces/ayushman098/telco-rca

--- /health Response ---
$HEALTH

--- /tasks Response ---
$TASKS
OUT

echo "Results saved to artifacts/hf_live_check.txt"
