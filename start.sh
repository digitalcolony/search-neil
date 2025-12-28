#!/bin/bash
set -x

# Railway logs can sometimes be delayed; sleep for a moment to ensure attachment
sleep 5

echo "[STARTUP] SCRIPT INITIALIZED" | tee /dev/stderr

# Configuration
# If DATA_DIR is set (Railway Volume), use it. Otherwise default to app root.
BASE_DIR=${DATA_DIR:-$(pwd)}
TRANSCRIPT_PATH="$BASE_DIR/transcripts"

echo "[STARTUP] Checking for transcripts in $TRANSCRIPT_PATH..." | tee /dev/stderr

# If transcripts directory is empty and we have a repo URL, clone it
if [ ! -d "$TRANSCRIPT_PATH" ] || [ -z "$(ls -A "$TRANSCRIPT_PATH")" ]; then
    if [ -n "$TRANSCRIPT_REPO_URL" ]; then
        echo "[STARTUP] Transcripts missing. Cloning from $TRANSCRIPT_REPO_URL..." | tee /dev/stderr
        mkdir -p "$BASE_DIR"
        git clone "$TRANSCRIPT_REPO_URL" "$TRANSCRIPT_PATH"
    else
        echo "[WARNING] Transcripts missing and TRANSCRIPT_REPO_URL not set!" | tee /dev/stderr
    fi
else
    echo "[STARTUP] Transcripts found. Ready to roll." | tee /dev/stderr
fi

# Run the app
echo "[STARTUP] Starting Node Server..." | tee /dev/stderr
NODE_ENV=production node web-app/server/index.js
