#!/bin/bash
# ============================================================
# Lexia CRM — Configuration webhook Sinch
# Usage: ./setup-webhook.sh <URL_NGROK>
# Exemple: ./setup-webhook.sh https://xxxx.ngrok-free.app
# ============================================================

set -e

NGROK_URL="${1}"

if [ -z "$NGROK_URL" ]; then
  echo ""
  echo "Usage: ./setup-webhook.sh <URL_NGROK>"
  echo "Exemple: ./setup-webhook.sh https://xxxx.ngrok-free.app"
  echo ""
  echo "Pour obtenir l'URL ngrok, lance dans un autre terminal:"
  echo "  ngrok http 3000"
  echo ""
  exit 1
fi

# Lire les credentials depuis .env
source .env

WEBHOOK_URL="${NGROK_URL}/webhook/sinch"
PROJECT_ID="${SINCH_PROJECT_ID}"
APP_ID="${SINCH_APP_ID}"
KEY_ID="${SINCH_KEY_ID}"
KEY_SECRET="${SINCH_KEY_SECRET}"

echo ""
echo "==> Obtention du token Sinch..."
TOKEN=$(curl -s -X POST https://auth.sinch.com/oauth2/token \
  -u "${KEY_ID}:${KEY_SECRET}" \
  -d "grant_type=client_credentials" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "ERREUR: Impossible d'obtenir le token Sinch. Vérifiez vos credentials."
  exit 1
fi
echo "    Token OK"

echo ""
echo "==> Ajout du webhook Lexia CRM: ${WEBHOOK_URL}"
RESULT=$(curl -s -X POST \
  "https://eu.conversation.api.sinch.com/v1/projects/${PROJECT_ID}/apps/${APP_ID}/webhooks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"app_id\": \"${APP_ID}\",
    \"target\": \"${WEBHOOK_URL}\",
    \"target_type\": \"HTTP\",
    \"triggers\": [\"MESSAGE_INBOUND\", \"MESSAGE_DELIVERY\", \"EVENT_INBOUND\"]
  }")

WEBHOOK_ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERREUR: '+str(d)))" 2>/dev/null)

echo ""
if [[ "$WEBHOOK_ID" == ERREUR* ]]; then
  echo "ERREUR lors de la création du webhook:"
  echo "$RESULT"
  exit 1
fi

echo "============================================"
echo "  Webhook créé avec succès!"
echo "  ID: ${WEBHOOK_ID}"
echo "  URL: ${WEBHOOK_URL}"
echo "  Triggers: MESSAGE_INBOUND, MESSAGE_DELIVERY, EVENT_INBOUND"
echo ""
echo "  Le webhook Supabase existant est CONSERVÉ."
echo "  Sinch enverra les events aux deux."
echo ""
echo "  Pour SUPPRIMER ce webhook après la démo:"
echo "  ./remove-webhook.sh ${WEBHOOK_ID}"
echo "============================================"
echo ""

# Sauvegarder l'ID pour pouvoir le supprimer facilement
echo "${WEBHOOK_ID}" > .webhook-id
