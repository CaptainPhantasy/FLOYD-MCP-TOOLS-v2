#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Prompt Library Backend..."
echo "GLM API Key: $(grep GLM_CODING_API_KEY .env | cut -d= -f2 | cut -c1-10)..."
ENABLE_HTTP=true node dist/index.js
