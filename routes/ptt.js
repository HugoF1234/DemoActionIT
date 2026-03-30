const express = require('express');
const router = express.Router();
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { detectActions } = require('./ai');
const { sendMessage, sendEmail } = require('../utils/sinch-client');

const DATA_PATH = path.join(__dirname, '../data/crm-data.json');

function loadData() { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
function saveData(d) { fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); }

// Store audio in memory (small files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max (Whisper limit)
});

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function findContactByName(name, contacts) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  const safe = contacts.filter(c => c.name);
  return (
    safe.find(c => c.name.toLowerCase() === lower) ||
    safe.find(c => c.name.toLowerCase().includes(lower)) ||
    safe.find(c => lower.includes(c.name.toLowerCase())) ||
    safe.find(c => words.some(w => c.name.toLowerCase().includes(w))) ||
    safe.find(c => c.name.toLowerCase().split(/\s+/).some(w => lower.includes(w) && w.length > 2))
  ) || null;
}

function addInteraction(data, contactId, fields) {
  const idx = data.contacts.findIndex(c => c.id === contactId);
  if (idx === -1) return;
  data.contacts[idx].interactions.unshift({
    id: `i${uuidv4().slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    status: 'processed',
    ...fields,
  });
  data.contacts[idx].lastContact = new Date().toISOString();
}

// POST /api/ptt — receive audio blob, transcribe, run AI pipeline
router.post('/', upload.single('audio'), async (req, res) => {
  const io = req.app.get('io');

  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier audio reçu' });
  }

  // Immediate response — processing is async via Socket.io
  res.json({ status: 'processing' });

  try {
    io.emit('ptt:start', { timestamp: new Date().toISOString() });
    io.emit('workflow:start', {
      id: uuidv4(),
      source: 'ptt',
      from: 'Opérateur CRM',
      content: '[Commande vocale]',
      isAudio: true,
      timestamp: new Date().toISOString(),
    });

    await delay(300);
    io.emit('workflow:processing', { message: 'Traitement de l\'audio...' });
    io.emit('workflow:transcribing', { message: 'Transcription vocale en cours...' });

    // Send to OpenAI Whisper
    const form = new FormData();
    const mimeType = req.file.mimetype || 'audio/webm';
    const extMap = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
    const ext = extMap[mimeType] || 'webm';

    form.append('file', req.file.buffer, { filename: `ptt.${ext}`, contentType: mimeType });
    form.append('model', 'whisper-1');
    form.append('language', 'fr');

    const whisperRes = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
      }
    );

    const transcript = whisperRes.data.text;
    io.emit('ptt:transcript', { transcript });
    io.emit('workflow:transcript', { transcript });

    await delay(400);
    io.emit('workflow:ai', { message: 'Lexia Intelligence — Analyse de la commande...' });

    const data = loadData();
    const settings = require('../utils/settings');
    const aiResult = await detectActions(transcript, data.contacts, settings.profileName || 'Hugo');

    io.emit('workflow:ai_done', {
      transcript,
      sentiment: aiResult.sentiment,
      category: aiResult.category,
      summary: aiResult.summary,
      actions: aiResult.actions,
    });

    // Execute actions
    const actionable = (aiResult.actions || []).filter(a => a.type !== 'NONE');
    const results = [];

    for (const action of actionable) {
      const freshData = loadData();
      const contact = findContactByName(action.target_contact, freshData.contacts);

      try {
        if (action.type === 'SEND_EMAIL') {
          if (!contact?.email) throw new Error('Email introuvable pour ce contact');
          await sendEmail(contact.email, action.subject || 'Message Lexia CRM', action.content);
          addInteraction(freshData, contact.id, { type: 'email', direction: 'outbound', content: action.content });
          saveData(freshData);
          results.push({ action: action.type, status: 'success', target: contact.name, detail: `Email → ${contact.email}` });
          io.emit('workflow:action', { type: 'SEND_EMAIL', contact: contact.name, detail: `Email → ${contact.email}` });

        } else if (action.type === 'SEND_SMS') {
          if (!contact?.phone) throw new Error('Téléphone introuvable');
          await sendMessage(contact.phone, action.content, 'SMS');
          addInteraction(freshData, contact.id, { type: 'sms', direction: 'outbound', content: action.content });
          saveData(freshData);
          results.push({ action: action.type, status: 'success', target: contact.name, detail: `SMS → ${contact.phone}` });
          io.emit('workflow:action', { type: 'SEND_SMS', contact: contact.name, detail: `SMS → ${contact.phone}` });

        } else if (action.type === 'SEND_WHATSAPP') {
          if (!contact?.whatsapp) throw new Error('WhatsApp introuvable');
          await sendMessage(contact.whatsapp, action.content, 'WHATSAPP');
          addInteraction(freshData, contact.id, { type: 'whatsapp', direction: 'outbound', content: action.content });
          saveData(freshData);
          results.push({ action: action.type, status: 'success', target: contact.name, detail: `WhatsApp → ${contact.whatsapp}` });
          io.emit('workflow:action', { type: 'SEND_WHATSAPP', contact: contact.name, detail: `WhatsApp → ${contact.whatsapp}` });

        } else if (action.type === 'UPDATE_CONTACT') {
          if (!contact) throw new Error('Contact introuvable');
          const idx = freshData.contacts.findIndex(c => c.id === contact.id);
          if (idx !== -1) {
            freshData.contacts[idx][action.field] = action.value;
            freshData.contacts[idx].lastContact = new Date().toISOString();
          }
          saveData(freshData);
          results.push({ action: action.type, status: 'success', target: contact.name, detail: `${action.field} → "${action.value}"` });
          io.emit('workflow:action', { type: 'UPDATE_CONTACT', contact: contact.name, detail: `${action.field} mis à jour` });

        } else if (action.type === 'ADD_NOTE') {
          if (!contact) throw new Error('Contact introuvable');
          const idx = freshData.contacts.findIndex(c => c.id === contact.id);
          if (idx !== -1) {
            const ts = new Date().toLocaleDateString('fr-FR');
            freshData.contacts[idx].notes = `[${ts}] ${action.content}\n\n${freshData.contacts[idx].notes || ''}`.trim();
          }
          saveData(freshData);
          results.push({ action: action.type, status: 'success', target: contact.name, detail: 'Note ajoutée' });
          io.emit('workflow:action', { type: 'ADD_NOTE', contact: contact.name, detail: 'Note ajoutée au CRM' });

        } else if (action.type === 'SET_SETTING') {
          const settings = require('../utils/settings');
          const field = action.field;
          const rawValue = action.value;
          let detail = '';
          if (field === 'confirmBeforeAction') {
            const val = rawValue === 'true' || rawValue === true;
            settings.confirmBeforeAction = val;
            detail = val ? 'Confirmation avant action activée' : 'Confirmation avant action désactivée';
            io.emit('settings:updated', { confirmBeforeAction: val });
          } else {
            detail = `Paramètre "${field}" mis à jour`;
          }
          results.push({ action: action.type, status: 'success', detail });
          io.emit('workflow:action', { type: 'SET_SETTING', detail });
        } else if (action.type === 'CREATE_CONTACT') {
          const nc = action.new_contact || {};
          const newName = (nc.name || action.target_contact || 'Nouveau contact').trim();
          const already = freshData.contacts.find(c => c.name && c.name.toLowerCase() === newName.toLowerCase());
          if (already) {
            results.push({ action: action.type, status: 'error', reason: `Contact "${newName}" existe déjà` });
            io.emit('workflow:action', { type: 'CREATE_CONTACT', contact: newName, detail: `Déjà existant` });
          } else {
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
            freshData.contacts.unshift(newContact);
            saveData(freshData);
            results.push({ action: action.type, status: 'success', target: newName, detail: `Contact créé: ${newName}` });
            io.emit('workflow:action', { type: 'CREATE_CONTACT', contact: newName, detail: `Nouveau contact créé dans le CRM` });
          }
        }
      } catch (err) {
        results.push({ action: action.type, status: 'error', reason: err.message });
        io.emit('workflow:action', { type: action.type, contact: action.target_contact, detail: `Erreur: ${err.message}` });
      }
    }

    // Log PTT interaction as a CRM note on the current context
    const finalData = loadData();
    const pttInteraction = {
      id: `i${uuidv4().slice(0, 6)}`,
      type: 'ptt',
      direction: 'outbound',
      content: `[Commande vocale PTT] ${transcript}`,
      transcript,
      isAudio: true,
      timestamp: new Date().toISOString(),
      status: 'processed',
      sentiment: aiResult.sentiment,
      category: aiResult.category,
      aiSummary: aiResult.summary,
      actionsDetected: actionable,
    };

    // If a target contact was found, attach to them
    const primaryAction = actionable[0];
    const targetContact = primaryAction ? findContactByName(primaryAction.target_contact, finalData.contacts) : null;
    if (targetContact) {
      const idx = finalData.contacts.findIndex(c => c.id === targetContact.id);
      if (idx !== -1) finalData.contacts[idx].interactions.unshift(pttInteraction);
      saveData(finalData);
    }

    io.emit('workflow:crm_updated', {
      contactId: targetContact?.id || null,
      contactName: targetContact?.name || 'CRM',
      interaction: pttInteraction,
      actionResults: results,
    });

    io.emit('ptt:done', { transcript, summary: aiResult.summary, results });
    io.emit('crm:refresh');

  } catch (err) {
    console.error('[PTT] Error:', err.message);
    io.emit('ptt:error', { message: err.message });
    io.emit('workflow:error', { message: `PTT: ${err.message}` });
  }
});

module.exports = router;
