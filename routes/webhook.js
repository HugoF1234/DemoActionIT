const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { transcribeAudio, detectActions } = require('./ai');
const { sendMessage, sendEmail } = require('../utils/sinch-client');

const DATA_PATH = path.join(__dirname, '../data/crm-data.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function findContactByName(name, contacts) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return (
    contacts.find((c) => c.name.toLowerCase() === lower) ||
    contacts.find((c) => c.name.toLowerCase().includes(lower)) ||
    contacts.find((c) => lower.includes(c.name.toLowerCase().split(' ')[0]))
  );
}

function findContactByPhone(phone, contacts) {
  const normalized = phone.replace(/\s/g, '');
  return contacts.find(
    (c) =>
      c.phone?.replace(/\s/g, '') === normalized ||
      c.whatsapp?.replace(/\s/g, '') === normalized
  );
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function executeActions(actions, contacts, io) {
  const results = [];
  const data = loadData();

  for (const action of actions) {
    const contact = findContactByName(action.target_contact, data.contacts);

    try {
      if (action.type === 'SEND_EMAIL') {
        if (!contact?.email) {
          results.push({ action: action.type, status: 'error', reason: 'Email introuvable pour ce contact' });
          continue;
        }
        await sendEmail(contact.email, action.subject || 'Message Lexia CRM', action.content);
        addInteraction(data, contact.id, { type: 'email', direction: 'outbound', content: action.content });
        results.push({ action: action.type, status: 'success', target: contact.name, detail: `Email envoyé à ${contact.email}` });
        io.emit('workflow:action', { type: 'SEND_EMAIL', contact: contact.name, detail: `Email → ${contact.email}` });

      } else if (action.type === 'SEND_SMS') {
        if (!contact?.phone) {
          results.push({ action: action.type, status: 'error', reason: 'Numéro introuvable pour ce contact' });
          continue;
        }
        await sendMessage(contact.phone, action.content, 'SMS');
        addInteraction(data, contact.id, { type: 'sms', direction: 'outbound', content: action.content });
        results.push({ action: action.type, status: 'success', target: contact.name, detail: `SMS envoyé à ${contact.phone}` });
        io.emit('workflow:action', { type: 'SEND_SMS', contact: contact.name, detail: `SMS → ${contact.phone}` });

      } else if (action.type === 'SEND_WHATSAPP') {
        if (!contact?.whatsapp) {
          results.push({ action: action.type, status: 'error', reason: 'WhatsApp introuvable pour ce contact' });
          continue;
        }
        await sendMessage(contact.whatsapp, action.content, 'WHATSAPP');
        addInteraction(data, contact.id, { type: 'whatsapp', direction: 'outbound', content: action.content });
        results.push({ action: action.type, status: 'success', target: contact.name, detail: `WhatsApp → ${contact.whatsapp}` });
        io.emit('workflow:action', { type: 'SEND_WHATSAPP', contact: contact.name, detail: `WhatsApp → ${contact.whatsapp}` });

      } else if (action.type === 'UPDATE_CONTACT') {
        if (!contact) {
          results.push({ action: action.type, status: 'error', reason: 'Contact introuvable' });
          continue;
        }
        const idx = data.contacts.findIndex((c) => c.id === contact.id);
        if (idx !== -1) {
          data.contacts[idx][action.field] = action.value;
          data.contacts[idx].lastContact = new Date().toISOString();
        }
        results.push({ action: action.type, status: 'success', target: contact.name, detail: `${action.field} → "${action.value}"` });
        io.emit('workflow:action', { type: 'UPDATE_CONTACT', contact: contact.name, detail: `${action.field} mis à jour: "${action.value}"` });

      } else if (action.type === 'CREATE_CONTACT') {
        const nc = action.new_contact || {};
        const newName = nc.name || action.target_contact || 'Nouveau contact';
        const exists = data.contacts.find(c => c.name.toLowerCase() === newName.toLowerCase());
        if (exists) {
          results.push({ action: action.type, status: 'error', reason: `Contact "${newName}" existe déjà` });
          continue;
        }
        const newContact = {
          id: `c${uuidv4().slice(0, 6)}`,
          name: newName,
          company: nc.company || '',
          email: nc.email || '',
          phone: nc.phone || '',
          whatsapp: nc.phone || '',
          status: nc.status || 'lead',
          segment: 'Standard',
          score: 40,
          assignedTo: 'Non assigné',
          tags: ['nouveau'],
          lastContact: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          notes: '',
          interactions: [],
        };
        data.contacts.unshift(newContact);
        results.push({ action: action.type, status: 'success', target: newName, detail: `Contact créé: ${newName}` });
        io.emit('workflow:action', { type: 'CREATE_CONTACT', contact: newName, detail: `Nouveau contact créé dans le CRM` });

      } else if (action.type === 'ADD_NOTE') {
        if (!contact) {
          results.push({ action: action.type, status: 'error', reason: 'Contact introuvable' });
          continue;
        }
        const idx = data.contacts.findIndex((c) => c.id === contact.id);
        if (idx !== -1) {
          const timestamp = new Date().toLocaleDateString('fr-FR');
          data.contacts[idx].notes = `[${timestamp}] ${action.content}\n\n${data.contacts[idx].notes || ''}`.trim();
        }
        results.push({ action: action.type, status: 'success', target: contact.name, detail: 'Note ajoutée' });
        io.emit('workflow:action', { type: 'ADD_NOTE', contact: contact.name, detail: 'Note CRM ajoutée' });
      }
    } catch (err) {
      console.error(`Action ${action.type} failed:`, err.message);
      results.push({ action: action.type, status: 'error', reason: err.message });
    }
  }

  saveData(data);
  return results;
}

function addInteraction(data, contactId, fields) {
  const idx = data.contacts.findIndex((c) => c.id === contactId);
  if (idx === -1) return;
  data.contacts[idx].interactions.unshift({
    id: `i${uuidv4().slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    status: 'processed',
    ...fields,
  });
  data.contacts[idx].lastContact = new Date().toISOString();
}

async function processInbound({ channel, from, content, mediaUrl, isAudio }, io) {
  const eventId = uuidv4();

  io.emit('workflow:start', {
    id: eventId,
    source: channel,
    from,
    content: content || '[message audio]',
    isAudio: !!isAudio,
    timestamp: new Date().toISOString(),
  });

  await delay(500);

  let transcript = content;

  if (isAudio && mediaUrl) {
    io.emit('workflow:processing', { message: 'Téléchargement de l\'audio...' });
    await delay(600);

    try {
      io.emit('workflow:transcribing', { message: 'Transcription vocale en cours...' });
      transcript = await transcribeAudio(mediaUrl);
      io.emit('workflow:transcript', { transcript });
    } catch (err) {
      console.error('Transcription error:', err.message);
      io.emit('workflow:error', { message: `Erreur transcription: ${err.message}` });
      return;
    }
  } else {
    io.emit('workflow:processing', { message: 'Parsing du message...' });
    await delay(700);
  }

    io.emit('workflow:ai', { message: 'Lexia Intelligence — Analyse en cours...' });

  const data = loadData();
  let aiResult;
  try {
    const settings = require('../utils/settings');
    aiResult = await detectActions(transcript, data.contacts, settings.profileName || 'Hugo');
  } catch (err) {
    console.error('GPT error:', err.message);
    aiResult = {
      actions: [],
      summary: transcript,
      sentiment: 'neutral',
      category: 'Autre',
    };
  }

  io.emit('workflow:ai_done', {
    transcript,
    sentiment: aiResult.sentiment,
    category: aiResult.category,
    summary: aiResult.summary,
    actions: aiResult.actions,
  });

  await delay(500);

  // Save inbound interaction
  const freshData = loadData();
  let contact = findContactByPhone(from, freshData.contacts);

  if (!contact) {
    contact = {
      id: `c${uuidv4().slice(0, 6)}`,
      name: `Inconnu (${from})`,
      company: '',
      email: '',
      phone: from,
      whatsapp: from,
      status: 'lead',
      segment: 'Standard',
      score: 40,
      assignedTo: 'Non assigné',
      tags: ['entrant', channel],
      lastContact: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes: '',
      interactions: [],
    };
    freshData.contacts.unshift(contact);
  }

  const interaction = {
    id: `i${uuidv4().slice(0, 6)}`,
    type: channel,
    direction: 'inbound',
    content: isAudio ? `[Vocal] ${transcript}` : transcript,
    transcript: isAudio ? transcript : undefined,
    isAudio: !!isAudio,
    timestamp: new Date().toISOString(),
    status: 'processed',
    sentiment: aiResult.sentiment,
    category: aiResult.category,
    aiSummary: aiResult.summary,
    actionsDetected: aiResult.actions?.filter((a) => a.type !== 'NONE') || [],
  };

  const idx = freshData.contacts.findIndex((c) => c.id === contact.id);
  if (idx !== -1) {
    freshData.contacts[idx].interactions.unshift(interaction);
    freshData.contacts[idx].lastContact = new Date().toISOString();
  }
  saveData(freshData);

  // Execute detected actions
  const actionableActions = (aiResult.actions || []).filter((a) => a.type !== 'NONE');
  let actionResults = [];
  if (actionableActions.length > 0) {
    actionResults = await executeActions(actionableActions, freshData.contacts, io);
  }

  io.emit('workflow:crm_updated', {
    contactId: contact.id,
    contactName: contact.name,
    interaction,
    actionResults,
  });

  // Confirm via WhatsApp if there were actions
  if (actionableActions.length > 0 && from) {
    const confirmLines = actionResults.map((r) =>
      r.status === 'success'
        ? `✓ ${r.action.replace('_', ' ')}: ${r.detail}`
        : `✗ ${r.action}: ${r.reason}`
    );
    const confirmMsg = `Lexia CRM — Actions effectuées:\n${confirmLines.join('\n')}`;
    try {
      await sendMessage(from, confirmMsg, channel === 'sms' ? 'SMS' : 'WHATSAPP');
    } catch (e) {
      console.warn('Could not send confirmation:', e.message);
    }
  }

  io.emit('crm:refresh');
}

// ─────────────────────────────────── REAL SINCH WEBHOOK
router.post('/sinch', async (req, res) => {
  const io = req.app.get('io');
  res.status(200).json({ status: 'ok' });

  try {
    const event = req.body;
    console.log('[Webhook] Sinch event:', JSON.stringify(event, null, 2));

    const msg = event.message;
    if (!msg) return;

    const from =
      event.contact?.channel_identities?.[0]?.identity ||
      msg.contact_id ||
      'unknown';
    const channel =
      (event.contact?.channel_identities?.[0]?.channel || 'UNKNOWN').toLowerCase();
    const contactMsg = msg.contact_message;

    let content = null;
    let mediaUrl = null;
    let isAudio = false;

    if (contactMsg?.text_message?.text) {
      content = contactMsg.text_message.text;
    } else if (contactMsg?.media_message) {
      const media = contactMsg.media_message;
      const mime = media.mime_type || '';
      if (mime.startsWith('audio/') || mime.includes('ogg') || mime.includes('mpeg')) {
        isAudio = true;
        mediaUrl = media.url;
      } else {
        content = `[Media: ${media.file_name || mime}]`;
      }
    } else if (contactMsg?.voice_message) {
      isAudio = true;
      mediaUrl = contactMsg.voice_message.url;
    }

    await processInbound({ channel, from, content, mediaUrl, isAudio }, io);
  } catch (err) {
    console.error('[Webhook] Error:', err);
  }
});

// ─────────────────────────────────── SIMULATION ENDPOINT
// ─────────────────────────────────── INBOUND TRANSCRIPT (depuis Supabase/Lovable)
// Reçoit un transcript déjà traité + numéro de téléphone, sans passer par Sinch
router.post('/inbound', async (req, res) => {
  const io = req.app.get('io');
  const { transcript, phone, channel = 'whatsapp' } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'transcript requis' });
  }

  res.json({ status: 'ok' });
  console.log(`[Inbound] ${channel} from ${phone}: ${transcript.slice(0, 80)}`);

  try {
    await processInbound({ channel, from: phone || 'unknown', content: transcript, isAudio: false }, io);
  } catch (err) {
    console.error('[Inbound] Error:', err);
    io.emit('workflow:error', { message: err.message });
  }
});

router.post('/simulate', async (req, res) => {
  const io = req.app.get('io');
  const {
    channel = 'whatsapp',
    from = '+33600000000',
    content = 'Message de simulation.',
    isAudio = false,
    mediaUrl = null,
  } = req.body;

  res.json({ status: 'simulation started' });

  try {
    await processInbound({ channel, from, content, mediaUrl, isAudio }, io);
  } catch (err) {
    console.error('[Simulate] Error:', err);
    io.emit('workflow:error', { message: err.message });
  }
});

module.exports = router;
module.exports.executeActions = executeActions;
