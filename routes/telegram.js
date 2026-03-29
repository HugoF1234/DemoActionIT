const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const { detectActions } = require('./ai');
const { sendMessage, sendEmail } = require('../utils/sinch-client');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_PATH = path.join(__dirname, '../data/crm-data.json');
function loadData() { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
function saveData(data) { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8'); }

function findContactByPhone(phone, contacts) {
  const n = phone.replace(/\s/g, '');
  return contacts.find(c => c.phone?.replace(/\s/g, '') === n || c.whatsapp?.replace(/\s/g, '') === n);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Store pending confirmations per chatId
const pendingConfirmations = new Map();

async function downloadTelegramFile(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const fileInfo = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const filePath = fileInfo.data.result.file_path;
  const response = await axios.get(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
    { responseType: 'arraybuffer' }
  );
  const ext = filePath.split('.').pop() || 'oga';
  const mimeMap = { oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };
  return {
    buffer: Buffer.from(response.data),
    mimeType: mimeMap[ext] || 'audio/ogg',
    ext,
  };
}

async function transcribeAudio(buffer, mimeType, ext) {
  const form = new FormData();
  form.append('file', buffer, { filename: `voice.${ext}`, contentType: mimeType });
  form.append('model', 'whisper-1');
  form.append('language', 'fr');
  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
    }
  );
  return response.data.text;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch {}
}

function buildActionSummary(actions) {
  return actions.map((a, i) => {
    if (a.type === 'SEND_EMAIL') return `${i + 1}. Email → ${a.target_contact || '?'} — ${a.subject || 'sans objet'}`;
    if (a.type === 'SEND_SMS') return `${i + 1}. SMS → ${a.target_contact || '?'}`;
    if (a.type === 'SEND_WHATSAPP') return `${i + 1}. WhatsApp → ${a.target_contact || '?'}`;
    if (a.type === 'UPDATE_CONTACT') return `${i + 1}. Mise à jour ${a.target_contact || '?'} — ${a.field} → "${a.value}"`;
    if (a.type === 'ADD_NOTE') return `${i + 1}. Note sur ${a.target_contact || '?'}`;
    if (a.type === 'CREATE_CONTACT') return `${i + 1}. Créer contact : ${a.new_contact?.name || '?'}`;
    return `${i + 1}. ${a.type}`;
  }).join('\n');
}

// ── Main processing pipeline ──────────────────────────────────
async function processTelegramMessage({ chatId, from, text, voiceFileId }, io, settings) {
  const eventId = uuidv4();
  const fromLabel = from?.username ? `@${from.username}` : (from?.first_name || String(chatId));
  const profileName = settings?.profileName || 'Hugo';
  const confirmBeforeAction = settings?.confirmBeforeAction || false;

  io.emit('workflow:start', {
    id: eventId,
    source: 'telegram',
    from: fromLabel,
    content: text || '[message vocal]',
    isAudio: !!voiceFileId,
    timestamp: new Date().toISOString(),
  });

  await delay(400);
  let transcript = text;

  if (voiceFileId) {
    io.emit('workflow:processing', { message: 'Téléchargement audio Telegram...' });
    await delay(400);
    try {
      const { buffer, mimeType, ext } = await downloadTelegramFile(voiceFileId);
      io.emit('workflow:transcribing', { message: 'Transcription vocale en cours...' });
      transcript = await transcribeAudio(buffer, mimeType, ext);
      io.emit('workflow:transcript', { transcript });
    } catch (err) {
      console.error('[Telegram] Transcription error:', err.message);
      io.emit('workflow:error', { message: `Erreur transcription: ${err.message}` });
      return;
    }
  } else {
    io.emit('workflow:processing', { message: 'Analyse du message...' });
    await delay(500);
  }

  io.emit('workflow:ai', { message: 'Lexia Intelligence — Analyse en cours...' });

  const data = loadData();
  let aiResult;
  try {
    aiResult = await detectActions(transcript, data.contacts, profileName);
  } catch (err) {
    aiResult = { actions: [], summary: transcript, sentiment: 'neutral', category: 'Autre' };
  }

  io.emit('workflow:ai_done', {
    transcript,
    sentiment: aiResult.sentiment,
    category: aiResult.category,
    summary: aiResult.summary,
    actions: aiResult.actions,
  });

  await delay(400);

  // Save contact + interaction
  const freshData = loadData();
  let contact = findContactByPhone(String(chatId), freshData.contacts);
  if (!contact) {
    contact = {
      id: `c${uuidv4().slice(0, 6)}`,
      name: fromLabel,
      company: '',
      email: '',
      phone: String(chatId),
      whatsapp: '',
      status: 'lead',
      segment: 'Standard',
      score: 40,
      assignedTo: 'Non assigné',
      tags: ['telegram', 'entrant'],
      lastContact: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes: '',
      interactions: [],
    };
    freshData.contacts.unshift(contact);
  }

  const interaction = {
    id: `i${uuidv4().slice(0, 6)}`,
    type: 'telegram',
    direction: 'inbound',
    content: voiceFileId ? `[Vocal] ${transcript}` : transcript,
    transcript: voiceFileId ? transcript : undefined,
    isAudio: !!voiceFileId,
    timestamp: new Date().toISOString(),
    status: 'processed',
    sentiment: aiResult.sentiment,
    category: aiResult.category,
    aiSummary: aiResult.summary,
    actionsDetected: aiResult.actions?.filter(a => a.type !== 'NONE') || [],
  };

  const idx = freshData.contacts.findIndex(c => c.id === contact.id);
  if (idx !== -1) {
    freshData.contacts[idx].interactions.unshift(interaction);
    freshData.contacts[idx].lastContact = new Date().toISOString();
  }
  saveData(freshData);
  io.emit('crm:refresh');

  const actionable = (aiResult.actions || []).filter(a => a.type !== 'NONE');

  // SET_SETTING is always executed immediately (meta-command), separate from confirmable actions
  const settingActions = actionable.filter(a => a.type === 'SET_SETTING');
  const confirmableActions = actionable.filter(a => a.type !== 'SET_SETTING');

  // Execute settings changes immediately
  if (settingActions.length > 0) {
    const { executeActions } = require('./webhook');
    const settingResults = await executeActions(settingActions, freshData.contacts, io);
    // Update the local settings reference
    if (settingActions.some(a => a.field === 'confirmBeforeAction')) {
      settings.confirmBeforeAction = settingActions.find(a => a.field === 'confirmBeforeAction')?.value === 'true';
    }
    const settingLines = settingResults.map(r =>
      r.status === 'success' ? `✓ ${r.detail}` : `✗ ${r.reason}`
    );
    await sendTelegramMessage(chatId, `Lexia CRM — Paramètre mis à jour :\n${settingLines.join('\n')}`);
    io.emit('crm:refresh');
  }

  if (confirmableActions.length === 0) {
    if (settingActions.length === 0) {
      // No actions at all — just acknowledge
      await sendTelegramMessage(chatId, `Lexia CRM : Compris. CRM mis à jour.\n\n<i>${aiResult.summary || ''}</i>`);
      io.emit('workflow:crm_updated', { contactId: contact.id, contactName: contact.name, interaction, actionResults: [] });
    }
    return;
  }

  if (settings?.confirmBeforeAction) {
    // Ask for confirmation via inline keyboard
    const summaryText = buildActionSummary(confirmableActions);
    const confirmMsg = `<b>Lexia Intelligence</b> a détecté ${confirmableActions.length} action${confirmableActions.length > 1 ? 's' : ''} :\n\n${summaryText}\n\nVoulez-vous exécuter ces actions ?`;

    const pendingId = eventId.slice(0, 8);
    pendingConfirmations.set(String(chatId), {
      pendingId,
      actionable: confirmableActions,
      contact,
      io,
      profileName,
      timestamp: Date.now(),
    });

    // Auto-expire in 5 minutes
    setTimeout(() => {
      if (pendingConfirmations.has(String(chatId))) {
        const p = pendingConfirmations.get(String(chatId));
        if (p?.pendingId === pendingId) pendingConfirmations.delete(String(chatId));
      }
    }, 5 * 60 * 1000);

    await sendTelegramMessage(chatId, confirmMsg, {
      inline_keyboard: [[
        { text: 'Confirmer ✓', callback_data: `confirm_yes:${pendingId}` },
        { text: 'Annuler ✗', callback_data: `confirm_no:${pendingId}` },
      ]],
    });
  } else {
    // Execute immediately
    const { executeActions } = require('./webhook');
    const actionResults = await executeActions(confirmableActions, freshData.contacts, io);
    saveData(loadData());

    io.emit('workflow:crm_updated', {
      contactId: contact.id,
      contactName: contact.name,
      interaction,
      actionResults,
    });

    const confirmLines = actionResults.map(r =>
      r.status === 'success' ? `✓ ${r.detail}` : `✗ ${r.reason}`
    );
    const reply = `Lexia CRM :\n${confirmLines.join('\n')}`;
    await sendTelegramMessage(chatId, reply);
  }
}

// ── Handle callback query (confirm / cancel) ──────────────────
async function handleCallbackQuery(callbackQuery, io) {
  const chatId = String(callbackQuery.message.chat.id);
  const data = callbackQuery.data || '';
  const callbackQueryId = callbackQuery.id;

  if (data.startsWith('confirm_yes:')) {
    const pendingId = data.split(':')[1];
    const pending = pendingConfirmations.get(chatId);

    if (!pending || pending.pendingId !== pendingId) {
      await answerCallbackQuery(callbackQueryId, 'Cette demande a expiré.');
      return;
    }

    pendingConfirmations.delete(chatId);
    await answerCallbackQuery(callbackQueryId, 'Exécution en cours...');

    const { executeActions } = require('./webhook');
    const actionResults = await executeActions(pending.actionable, loadData().contacts, pending.io || io);

    io.emit('workflow:crm_updated', {
      contactId: pending.contact.id,
      contactName: pending.contact.name,
      actionResults,
    });
    io.emit('crm:refresh');

    const confirmLines = actionResults.map(r =>
      r.status === 'success' ? `✓ ${r.detail}` : `✗ ${r.reason}`
    );
    await sendTelegramMessage(chatId, `Lexia CRM — Actions exécutées :\n${confirmLines.join('\n')}`);

  } else if (data.startsWith('confirm_no:')) {
    const pendingId = data.split(':')[1];
    const pending = pendingConfirmations.get(chatId);

    if (pending?.pendingId === pendingId) pendingConfirmations.delete(chatId);
    await answerCallbackQuery(callbackQueryId, 'Actions annulées.');
    await sendTelegramMessage(chatId, 'Lexia CRM : Actions annulées. Aucune modification effectuée.');
  } else {
    await answerCallbackQuery(callbackQueryId);
  }
}

// ── Webhook endpoint ──────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  const io = req.app.get('io');
  const settings = req.app.locals.settings || require('../utils/settings');
  res.status(200).json({ ok: true });

  try {
    const update = req.body;

    // Handle inline keyboard button presses
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, io);
      return;
    }

    const msg = update.message || update.edited_message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const from = msg.from;
    const text = msg.text || msg.caption || null;
    const voiceFileId = msg.voice?.file_id || msg.audio?.file_id || null;

    if (!text && !voiceFileId) {
      console.log('[Telegram] Message ignoré (type non supporté)');
      return;
    }

    console.log(`[Telegram] Message from ${from?.username || chatId}: ${text || '[vocal]'}`);
    await processTelegramMessage({ chatId, from, text, voiceFileId }, io, settings);

  } catch (err) {
    console.error('[Telegram] Erreur webhook:', err.message, err.stack);
    // Try to notify the user if we can extract a chatId
    try {
      const msg = req.body?.message;
      if (msg?.chat?.id) {
        await sendTelegramMessage(msg.chat.id, `Lexia CRM — Erreur interne: ${err.message}`);
      }
    } catch {}
  }
});

// ── Setup endpoint — enregistre le webhook Telegram ───────────
router.get('/setup', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN non configuré dans .env' });

  const tunnelUrl = req.query.url;
  if (!tunnelUrl) return res.status(400).json({ error: 'Paramètre ?url=https://... requis' });

  const webhookUrl = `${tunnelUrl}/telegram/webhook`;

  try {
    const result = await axios.post(
      `https://api.telegram.org/bot${token}/setWebhook`,
      { url: webhookUrl, drop_pending_updates: true }
    );
    console.log('[Telegram] Webhook enregistré:', webhookUrl);
    res.json({ ok: true, webhook_url: webhookUrl, telegram: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Info endpoint ─────────────────────────────────────────────
router.get('/info', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN non configuré' });
  try {
    const result = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
