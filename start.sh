#!/bin/bash

# Configuration
# If DATA_DIR is set (Railway Volume), use it. Otherwise default to app root.
BASE_DIR=${DATA_DIR:-$(pwd)}
TRANSCRIPT_PATH="$BASE_DIR/transcripts"

echo "[STARTUP] Checking for transcripts in $TRANSCRIPT_PATH..."

# If transcripts directory is empty and we have a repo URL, clone it
if [ ! -d "$TRANSCRIPT_PATH" ] || [ -z "$(ls -A "$TRANSCRIPT_PATH")" ]; then
    if [ -n "$TRANSCRIPT_REPO_URL" ]; then
        echo "[STARTUP] Transcripts missing. Cloning from $TRANSCRIPT_REPO_URL..."
        mkdir -p "$BASE_DIR"
        git clone "$TRANSCRIPT_REPO_URL" "$TRANSCRIPT_PATH"
    else
        echo "[WARNING] Transcripts missing and TRANSCRIPT_REPO_URL not set!"
    fi
else
    echo "[STARTUP] Transcripts found. Ready to roll."
fi

# Run the app
NODE_ENV=production node web-app/server/index.js
