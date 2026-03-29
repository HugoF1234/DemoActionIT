# Lexia CRM — Sinch Demo

Démonstration d'un CRM temps réel intégré avec Sinch (WhatsApp, SMS, Email) et le moteur d'analyse Lexia Intelligence.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    localhost:3000                    │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │   Sidebar   │  │  CRM Detail  │  │   Stats   │  │
│  │  Contacts   │  │ Interactions │  │ Channels  │  │
│  └─────────────┘  └──────────────┘  └───────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │  WORKFLOW: Source → Sinch → Traitement → AI → CRM││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Stack technique

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: HTML/CSS/JS vanilla (dark UI)
- **Messaging**: Sinch Conversation API (WhatsApp app dédiée + SMS)
- **Speech-to-Text**: OpenAI Whisper
- **Intelligence**: OpenAI GPT-4o-mini (Lexia Intelligence)
- **Email**: Resend API
- **Temps réel**: Socket.io

## Installation

```bash
npm install
```

## Configuration `.env`

```ini
# SMS (ancienne app)
SINCH_KEY_ID=...
SINCH_KEY_SECRET=...
SINCH_PROJECT_ID=...
SINCH_APP_ID=...
SINCH_SMS_NUMBER=+46765106163

# WhatsApp (nouvelle app dédiée — projet 42977f62)
SINCH_WA_KEY_ID=...
SINCH_WA_KEY_SECRET=...
SINCH_WA_PROJECT_ID=42977f62-c06b-44f6-ab80-ca8a2ed17bdc
SINCH_WA_APP_ID=01KMWSM3A79TZT8QXSXBH5NXAP

# Email (Resend)
RESEND_API_KEY=re_...
RESEND_SENDER_EMAIL=onboarding@resend.dev
RESEND_SENDER_NAME=Lexia CRM

# OpenAI
OPENAI_API_KEY=sk-proj-...
```

## Démarrage

```bash
# Terminal 1 — serveur
npm run dev

# Terminal 2 — tunnel public (sous-domaine fixe)
npx localtunnel --port 3000 --subdomain lexia-demo
# → URL fixe: https://lexia-demo.loca.lt
```

## Configuration webhook Sinch (WhatsApp)

> **À faire une seule fois** dans le dashboard Sinch (projet 42977f62).

1. [dashboard.sinch.com](https://dashboard.sinch.com) → sélectionner le projet **42977f62**
2. **Conversation API → Apps → Hugo → Webhooks**
3. Créer ou modifier le webhook :
   - **URL**: `https://lexia-demo.loca.lt/webhook/sinch`
   - **Triggers**: `MESSAGE_INBOUND`, `MESSAGE_DELIVERY`, `EVENT_INBOUND`
4. Sauvegarder

Grâce au sous-domaine fixe (`--subdomain lexia-demo`), l'URL ne change jamais entre les sessions.

## Fonctionnalités

### CRM
- Liste des contacts avec filtre et recherche
- Fiche contact : score, tags, historique d'interactions
- Création de contacts (via UI ou message entrant)

### Messaging
- WhatsApp (app dédiée Sinch, projet 42977f62)
- SMS (ancienne app Sinch)
- Email (Resend)

### Push-to-Talk (barre espace)
- Maintenir `Espace` → enregistre le microphone
- Relâcher → Transcription OpenAI Whisper + analyse Lexia Intelligence
- Actions CRM exécutées automatiquement

### Workflow temps réel
- Pipeline 5 étapes : Source → Sinch → Traitement → Lexia Intelligence → CRM
- Log live avec timestamps

### WhatsApp entrant
- Audio WhatsApp → Whisper → Lexia Intelligence → actions CRM
- Création automatique de contact si inconnu

## API Routes

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/crm/contacts` | Liste des contacts |
| GET | `/api/crm/contacts/:id` | Détail d'un contact |
| POST | `/api/crm/contacts` | Créer un contact |
| PATCH | `/api/crm/contacts/:id` | Modifier un contact |
| POST | `/api/crm/contacts/:id/interactions` | Ajouter une interaction |
| GET | `/api/crm/stats` | Statistiques globales |
| POST | `/api/sinch/send` | Envoyer WhatsApp/SMS |
| POST | `/api/sinch/send-email` | Envoyer un email |
| POST | `/webhook/sinch` | Webhook Sinch (entrant) |
| POST | `/webhook/simulate` | Simuler un message entrant |
| POST | `/api/ptt` | Push-to-Talk audio upload |
