#!/bin/bash
# Sends the clean compose file (no build:, with registry images) to the
# Zoneploy API to start the stack deployment.
set -euo pipefail

CLEAN_COMPOSE="/tmp/zp-compose-clean.yml"

if [ ! -f "$CLEAN_COMPOSE" ]; then
  echo "::error::Processed compose file not found. Make sure the 'Build & push stack images' step ran successfully."
  exit 1
fi

RESPONSE=$(curl -s -X POST "${ZP_API_URL}/api/v1/deploy" \
  -H "Authorization: Bearer ${ZP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg composeFile "$(base64 -w 0 "$CLEAN_COMPOSE")" \
    '{composeFile: $composeFile}')" \
  -w "\n%{http_code}") || true

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" != "202" ]; then
  if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    echo "::error::Unauthorized: invalid or expired deploy token."
  elif [ "$HTTP_CODE" = "404" ]; then
    echo "::error::Deploy token not found. Make sure the token exists in your Zoneploy organization."
  else
    echo "::error::Deploy failed (HTTP $HTTP_CODE): $BODY"
  fi
  exit 1
fi

echo "Deploy started: $(echo "$BODY" | jq -r '.deployUrl // .message // "ok"')"
