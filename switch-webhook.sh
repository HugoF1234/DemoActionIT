#!/bin/bash
# ============================================================
# Lexia CRM — Gestion du webhook WhatsApp (nouvelle app dédiée)
# ============================================================
# Usage:
#   ./switch-webhook.sh https://xxxx.loca.lt   → Pointe vers ce tunnel
#   ./switch-webhook.sh restore                  → Supprime le webhook démo
# ============================================================

DEMO_ID_FILE=".webhook-demo-id"

# Parse .env safely
if [ -f .env ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%%#*}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    export "$key"="$value"
  done < .env
fi

# Determine mode
if [[ "${1}" == "restore" ]]; then
  MODE="restore"
elif [[ "${1}" == http* ]]; then
  MODE="demo"; TUNNEL_URL="${1}"
elif [[ "${1}" == "demo" ]]; then
  MODE="demo"; TUNNEL_URL="${2}"
else
  echo ""
  echo "Usage:"
  echo "  ./switch-webhook.sh https://xxxx.loca.lt   → Activer la démo"
  echo "  ./switch-webhook.sh restore                  → Désactiver la démo"
  echo ""
  exit 1
fi

if [ "$MODE" = "demo" ] && [ -z "$TUNNEL_URL" ]; then
  echo "Erreur: URL du tunnel manquante."
  exit 1
fi

# Use WhatsApp-specific credentials
WA_KEY_ID="${SINCH_WA_KEY_ID:-$SINCH_KEY_ID}"
WA_KEY_SECRET="${SINCH_WA_KEY_SECRET:-$SINCH_KEY_SECRET}"
WA_PROJECT_ID="${SINCH_WA_PROJECT_ID:-$SINCH_PROJECT_ID}"
WA_APP_ID="${SINCH_WA_APP_ID:-$SINCH_APP_ID}"
API_BASE="https://eu.conversation.api.sinch.com/v1/projects/${WA_PROJECT_ID}/apps/${WA_APP_ID}/webhooks"

echo ""
echo "==> Obtention du token Sinch (WhatsApp)..."
TOKEN=$(curl -s -X POST https://auth.sinch.com/oauth2/token \
  -u "${WA_KEY_ID}:${WA_KEY_SECRET}" \
  -d "grant_type=client_credentials" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "ERREUR: Impossible d'obtenir le token. Vérifiez SINCH_WA_KEY_ID / SINCH_WA_KEY_SECRET dans .env"
  exit 1
fi
echo "   Token OK ✓"

# ── MODE DEMO ────────────────────────────────────────────────
if [ "$MODE" = "demo" ]; then
  TARGET="${TUNNEL_URL}/webhook/sinch"

  # Delete existing demo webhook if one was registered
  if [ -f "$DEMO_ID_FILE" ]; then
    OLD_ID=$(cat "$DEMO_ID_FILE")
    echo "==> Suppression de l'ancien webhook démo (${OLD_ID})..."
    curl -s -X DELETE "${API_BASE}/${OLD_ID}" -H "Authorization: Bearer ${TOKEN}" > /dev/null
    rm -f "$DEMO_ID_FILE"
  fi

  echo "==> Création d'un webhook → ${TARGET}"
  RESULT=$(curl -s -X POST "${API_BASE}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"app_id\": \"${WA_APP_ID}\",
      \"target\": \"${TARGET}\",
      \"target_type\": \"HTTP\",
      \"triggers\": [\"MESSAGE_INBOUND\", \"MESSAGE_DELIVERY\", \"EVENT_INBOUND\"]
    }")

  NEW_ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

  if [ -z "$NEW_ID" ]; then
    echo ""
    echo "ERREUR lors de la création du webhook:"
    echo "$RESULT"
    echo ""
    echo "─────────────────────────────────────────────────────"
    echo "Fallback: configurez manuellement dans le dashboard Sinch"
    echo "  Projet: ${WA_PROJECT_ID}"
    echo "  App: ${WA_APP_ID}"
    echo "  URL: ${TARGET}"
    echo "  Triggers: MESSAGE_INBOUND, MESSAGE_DELIVERY, EVENT_INBOUND"
    echo "─────────────────────────────────────────────────────"
    exit 1
  fi

  echo "$NEW_ID" > "$DEMO_ID_FILE"

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║              WEBHOOK WHATSAPP ACTIF                  ║"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  App: ${WA_APP_ID}"
  echo "║  Webhook ID: ${NEW_ID}"
  echo "║  URL: ${TARGET}"
  echo "║"
  echo "║  Les messages WhatsApp arrivent sur ce serveur."
  echo "║"
  echo "║  Pour désactiver: ./switch-webhook.sh restore"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""

# ── MODE RESTORE ─────────────────────────────────────────────
else
  if [ ! -f "$DEMO_ID_FILE" ]; then
    echo "Aucun webhook démo actif (${DEMO_ID_FILE} absent). Rien à faire."
    exit 0
  fi

  DEMO_ID=$(cat "$DEMO_ID_FILE")
  echo "==> Suppression du webhook démo (${DEMO_ID})..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "${API_BASE}/${DEMO_ID}" \
    -H "Authorization: Bearer ${TOKEN}")

  rm -f "$DEMO_ID_FILE"

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "204" || "$HTTP_CODE" == "404" ]]; then
    echo "║  Webhook démo supprimé (HTTP ${HTTP_CODE})."
  else
    echo "║  ATTENTION: HTTP ${HTTP_CODE} — vérifiez le dashboard."
  fi
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
fi
