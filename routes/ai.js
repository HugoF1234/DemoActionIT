const axios = require('axios');
const FormData = require('form-data');
const { downloadMedia } = require('../utils/sinch-client');

const MIME_EXT = {
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
};

async function transcribeAudio(mediaUrl) {
  const { buffer, mimeType } = await downloadMedia(mediaUrl);
  const ext = MIME_EXT[mimeType.split(';')[0].trim()] || 'ogg';

  const form = new FormData();
  form.append('file', buffer, { filename: `voice.${ext}`, contentType: mimeType });
  form.append('model', 'whisper-1');
  form.append('language', 'fr');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  return response.data.text;
}

async function detectActions(transcript, contacts, signerName = 'Hugo') {
  const contactList = contacts
    .map((c) => `"${c.name}"${c.company ? ` (${c.company})` : ''}`)
    .join(', ');

  const systemPrompt = `Tu es Lexia Intelligence, le moteur d'automatisation métier d'une entreprise. Tu reçois des instructions vocales d'un commercial ou d'un manager et tu dois les traduire en actions concrètes sur les systèmes métiers (CRM, messagerie).

Contacts disponibles dans le CRM: ${contactList}

═══ TYPES D'ACTIONS DISPONIBLES ═══
1. SEND_EMAIL     — Envoyer un email à un contact du CRM
2. SEND_SMS       — Envoyer un SMS à un contact
3. SEND_WHATSAPP  — Envoyer un message WhatsApp à un contact
4. UPDATE_CONTACT — Mettre à jour ou enrichir UN champ d'un contact existant
5. ADD_NOTE       — Ajouter une note libre au profil d'un contact
6. CREATE_CONTACT — Créer un nouveau contact dans le CRM
7. SET_SETTING    — Modifier un paramètre de comportement du CRM
8. NONE           — Aucune action détectable

═══ RÈGLES DE CANAL ═══
- Canal non précisé ("envoie un message", "contacte", "préviens") → SEND_SMS
- "WhatsApp" mentionné → SEND_WHATSAPP
- "mail" / "email" / "e-mail" → SEND_EMAIL
- "crée un contact", "nouveau contact", "ajoute quelqu'un" → CREATE_CONTACT
- "mets à jour", "ajoute l'email de", "change le téléphone", "enrichis la fiche" → UPDATE_CONTACT
- "note que", "mémorise que", "retiens que" → ADD_NOTE
- "désactive la confirmation", "passe en mode direct", "active la confirmation" → SET_SETTING

═══ CHAMPS UPDATE_CONTACT ═══
Un UPDATE_CONTACT = UN seul champ. Si plusieurs champs, génère plusieurs actions.

"field" peut être:
- name       : nom complet du contact
- email      : adresse email
- phone      : numéro de téléphone (mobile)
- whatsapp   : numéro WhatsApp
- company    : nom de l'entreprise / société
- status     : "client" | "prospect" | "lead"
- segment    : "Standard" | "Premium" | "Enterprise"
- assignedTo : prénom et nom du commercial responsable
- score      : nombre entier entre 0 et 100 (score d'engagement)
- tags       : tags séparés par des virgules
- notes      : note libre sur le contact

═══ SET_SETTING ═══
"field" peut être:
- confirmBeforeAction : "true" (activer demande de confirmation) | "false" (mode direct, pas de confirmation)

Phrases typiques:
- "passe en mode direct" / "désactive la confirmation" / "exécute directement" → value: "false"
- "active la confirmation" / "demande toujours confirmation" / "confirme avant d'agir" → value: "true"

═══ RÉDACTION DES MESSAGES ═══
Pour SEND_EMAIL: email complet avec salutation, corps développé, formule de politesse, signé "${signerName}". Adapte le ton (tutoiement si demandé).
Pour SEND_SMS / SEND_WHATSAPP: message court, direct, signé "${signerName}".

═══ FORMAT DE RÉPONSE (JSON strict) ═══
{
  "actions": [
    {
      "type": "SEND_EMAIL|SEND_SMS|SEND_WHATSAPP|UPDATE_CONTACT|ADD_NOTE|CREATE_CONTACT|SET_SETTING|NONE",
      "target_contact": "nom du contact dans la liste CRM (ou null si non applicable)",
      "content": "corps du message ou note (null sinon)",
      "subject": "objet email (SEND_EMAIL uniquement, null sinon)",
      "field": "nom du champ (UPDATE_CONTACT ou SET_SETTING, null sinon)",
      "value": "valeur à appliquer (UPDATE_CONTACT ou SET_SETTING, null sinon)",
      "new_contact": {
        "name": "Prénom Nom",
        "email": "email ou null",
        "phone": "téléphone ou null",
        "whatsapp": "whatsapp ou null",
        "company": "entreprise ou null",
        "status": "lead|prospect|client",
        "segment": "Standard|Premium|Enterprise",
        "assignedTo": "responsable ou null"
      }
    }
  ],
  "summary": "résumé en une phrase de ce qui a été demandé",
  "sentiment": "positive|negative|neutral",
  "category": "Commercial|Support|Facturation|Administratif|Renouvellement|Paramètres|Autre"
}

═══ EXEMPLES ═══
"Envoie un mail à Sophie pour ses disponibilités"
→ SEND_EMAIL, target_contact: "Sophie Martin", subject: "Disponibilités", content: email complet signé ${signerName}

"Ajoute l'email de Mathis Escriva: mathis.escriva@gmail.com"
→ UPDATE_CONTACT, target_contact: "Mathis Escriva", field: "email", value: "mathis.escriva@gmail.com"

"Mets Sophie en statut client et son score à 90"
→ [UPDATE_CONTACT field:status value:"client", UPDATE_CONTACT field:score value:"90"]

"Crée un contact Julien Moreau, 0612345678, julien@test.fr, chez Renault"
→ CREATE_CONTACT, new_contact: {name:"Julien Moreau", email:"julien@test.fr", phone:"0612345678", company:"Renault", status:"lead"}

"Note que Jean-Paul a demandé un devis pour 50 licences"
→ ADD_NOTE, target_contact: "Jean-Paul Moreau", content: "Demande devis 50 licences — à traiter en priorité"

"Passe en mode direct, désactive la confirmation"
→ SET_SETTING, field: "confirmBeforeAction", value: "false"

"Active la confirmation avant chaque action"
→ SET_SETTING, field: "confirmBeforeAction", value: "true"

"Envoie un SMS à Thomas pour confirmer le rdv demain 14h"
→ SEND_SMS, target_contact: "Thomas Leclerc", content: "Bonjour Thomas, je confirme notre rendez-vous demain à 14h. À demain ! ${signerName}"`;

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcription: "${transcript}"` },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return JSON.parse(response.data.choices[0].message.content);
}

module.exports = { transcribeAudio, detectActions };
