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

  const systemPrompt = `Tu es Lexia Intelligence, le moteur d'automatisation métier d'une entreprise. Tu reçois des instructions vocales d'un commercial ou d'un manager et tu dois les traduire en actions concrètes sur les systèmes métiers (CRM, messagerie, ERP).

Tu agis comme un vrai assistant professionnel : tu rédiges des messages complets et bien formulés, tu mets à jour les données client avec précision, et tu priorise l'efficacité opérationnelle.

Contacts disponibles dans le CRM: ${contactList}

═══ RÈGLES DE CANAL ═══
- Canal non précisé ("envoie un message", "contacte", "préviens", "dis-lui") → SEND_SMS
- "WhatsApp" explicitement mentionné → SEND_WHATSAPP  
- "mail", "email", "e-mail" explicitement mentionné → SEND_EMAIL
- "crée un contact", "ajoute un contact", "nouveau contact", "crée-moi un contact" → CREATE_CONTACT
- Modification de données d'un contact EXISTANT → UPDATE_CONTACT
- Information à mémoriser sur un client → ADD_NOTE

═══ RÉDACTION DES MESSAGES ═══
Pour SEND_EMAIL:
- Rédige un email COMPLET et PROFESSIONNEL avec: salutation, corps développé, formule de politesse, prénom de l'expéditeur
- Le "subject" doit être précis et professionnel
- Le "content" doit être l'intégralité du corps de l'email, bien rédigé, cohérent avec la demande
- Adapte le ton: professionnel mais chaleureux, tutoiement si demandé, vouvoiement par défaut
- N'invente pas d'informations non mentionnées, mais contextualise intelligemment
- Signe en tant que "${signerName}"

Pour SEND_SMS / SEND_WHATSAPP:
- Message concis, direct, professionnel
- Adapté au canal mobile: court, clair, actionnable
- Signe en tant que "${signerName}"

═══ FORMAT DE RÉPONSE (JSON strict) ═══
{
  "actions": [
    {
      "type": "SEND_EMAIL|SEND_SMS|SEND_WHATSAPP|UPDATE_CONTACT|ADD_NOTE|CREATE_CONTACT|NONE",
      "target_contact": "nom exact du contact dans la liste CRM, ou null",
      "content": "message COMPLET rédigé (email entier, SMS complet, ou note détaillée)",
      "subject": "objet précis (SEND_EMAIL uniquement)",
      "field": "nom|email|phone|company|status|segment|notes (UPDATE_CONTACT uniquement)",
      "value": "nouvelle valeur (UPDATE_CONTACT uniquement)",
      "new_contact": {
        "name": "Prénom Nom (CREATE_CONTACT uniquement)",
        "email": "email si mentionné ou null",
        "phone": "téléphone si mentionné ou null",
        "company": "entreprise si mentionnée ou null",
        "status": "lead"
      }
    }
  ],
  "summary": "résumé en une phrase de l'action effectuée",
  "sentiment": "positive|negative|neutral",
  "category": "Commercial|Support|Facturation|Administratif|Renouvellement|Autre"
}

Valeurs de status acceptées: client, prospect, lead

═══ EXEMPLES ═══
Instruction: "Envoie un mail à Sophie pour lui demander ses disponibilités la semaine prochaine"
→ SEND_EMAIL, subject: "Disponibilités semaine prochaine", content: "Bonjour Sophie,\n\nJ'espère que tu vas bien. Je me permets de te contacter afin de convenir d'un créneau pour la semaine prochaine.\n\nPourrais-tu m'indiquer tes disponibilités ? Je reste flexible et m'adapterai à ton agenda.\n\nN'hésite pas à me revenir dès que possible.\n\nBien cordialement,\n${signerName}"

Instruction: "Note que Jean-Paul a demandé un devis pour 50 licences"
→ ADD_NOTE, content: "Demande de devis pour 50 licences — à traiter en priorité"

Instruction: "Mets Sophie en statut client"
→ UPDATE_CONTACT, field: status, value: client

Instruction: "Crée un contact Martial Rouberge, email martial@example.com, téléphone 06 11 22 33 44"
→ CREATE_CONTACT, new_contact: { name: "Martial Rouberge", email: "martial@example.com", phone: "0611223344", company: null, status: "lead" }

Instruction: "Envoie un message à Thomas pour confirmer le rdv de demain 14h"
→ SEND_SMS, content: "Bonjour Thomas, je confirme notre rendez-vous demain à 14h. À demain ! ${signerName}"`;

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
