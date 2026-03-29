#!/bin/bash
# Supprime le webhook ajouté pour la démo
# Usage: ./remove-webhook.sh [WEBHOOK_ID]

set -e
while IFS='=' read -r key value; do
  [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
  value="${value%%#*}"; value="${value%"${value##*[![:space:]]}"}"
  export "$key=$value"
done < .env

WEBHOOK_ID="${1}"
if [ -z "$WEBHOOK_ID" ] && [ -f ".webhook-id" ]; then
  WEBHOOK_ID=$(cat .webhook-id)
fi

if [ -z "$WEBHOOK_ID" ]; then
  echo "Usage: ./remove-webhook.sh <WEBHOOK_ID>"
  exit 1
fi

TOKEN=$(curl -s -X POST https://auth.sinch.com/oauth2/token \
  -u "${SINCH_KEY_ID}:${SINCH_KEY_SECRET}" \
  -d "grant_type=client_credentials" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -X DELETE \
  "https://eu.conversation.api.sinch.com/v1/projects/${SINCH_PROJECT_ID}/apps/${SINCH_APP_ID}/webhooks/${WEBHOOK_ID}" \
  -H "Authorization: Bearer ${TOKEN}"

echo "Webhook ${WEBHOOK_ID} supprimé."
rm -f .webhook-id
