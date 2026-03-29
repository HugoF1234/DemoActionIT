const axios = require('axios');

// ── Token cache (SMS app) ────────────────────────────────────
let cachedToken = null;
let tokenExpiry = null;

async function getSinchToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  const credentials = Buffer.from(
    `${process.env.SINCH_KEY_ID}:${process.env.SINCH_KEY_SECRET}`
  ).toString('base64');
  const response = await axios.post(
    'https://auth.sinch.com/oauth2/token',
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cachedToken;
}

// ── Token cache (WhatsApp app) ───────────────────────────────
let cachedWaToken = null;
let waTokenExpiry = null;

async function getWaSinchToken() {
  // If no dedicated WA credentials, fall back to SMS credentials
  const keyId = process.env.SINCH_WA_KEY_ID || process.env.SINCH_KEY_ID;
  const keySecret = process.env.SINCH_WA_KEY_SECRET || process.env.SINCH_KEY_SECRET;

  if (cachedWaToken && waTokenExpiry && Date.now() < waTokenExpiry) return cachedWaToken;
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await axios.post(
    'https://auth.sinch.com/oauth2/token',
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  cachedWaToken = response.data.access_token;
  waTokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cachedWaToken;
}

// ── Send message ─────────────────────────────────────────────
async function sendMessage(to, message, channel) {
  const isWhatsApp = channel.toUpperCase() === 'WHATSAPP';

  // Use WA-specific project/app if configured
  const projectId = isWhatsApp
    ? (process.env.SINCH_WA_PROJECT_ID || process.env.SINCH_PROJECT_ID)
    : process.env.SINCH_PROJECT_ID;
  const appId = isWhatsApp
    ? (process.env.SINCH_WA_APP_ID || process.env.SINCH_APP_ID)
    : process.env.SINCH_APP_ID;
  const token = isWhatsApp ? await getWaSinchToken() : await getSinchToken();

  const body = {
    app_id: appId,
    recipient: {
      identified_by: {
        channel_identities: [{ channel: channel.toUpperCase(), identity: to }],
      },
    },
    message: { text_message: { text: message } },
  };

  if (channel.toUpperCase() === 'SMS') {
    body.channel_properties = { SMS_SENDER: process.env.SINCH_SMS_NUMBER };
  }

  const response = await axios.post(
    `https://eu.conversation.api.sinch.com/v1/projects/${projectId}/messages:send`,
    body,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return response.data;
}

// ── Send email (Brevo) ───────────────────────────────────────
async function sendEmail(to, subject, content) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('Clé API Brevo non configurée. Ajoutez BREVO_API_KEY dans le fichier .env');
  }

  const fromEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@lexia.fr';
  const fromName  = process.env.BREVO_SENDER_NAME  || 'Lexia CRM';

  const response = await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject: subject || 'Message Lexia CRM',
      textContent: content,
      htmlContent: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px 24px">
        <p style="font-size:15px;line-height:1.8;color:#1a1a2e;white-space:pre-line">${content.replace(/\n/g, '<br>')}</p>
      </div>`,
    },
    {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
    }
  );

  console.log('[Brevo] Email envoyé:', response.data);
  return response.data;
}

// ── Download media ───────────────────────────────────────────
// Tries without auth first, then with WA token, then with SMS token
async function downloadMedia(url) {
  const attempts = [
    () => axios.get(url, { responseType: 'arraybuffer', timeout: 15000 }),
    async () => {
      const token = await getWaSinchToken();
      return axios.get(url, { responseType: 'arraybuffer', timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
    },
    async () => {
      const token = await getSinchToken();
      return axios.get(url, { responseType: 'arraybuffer', timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
    },
  ];

  let lastErr;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      return {
        buffer: Buffer.from(response.data),
        mimeType: response.headers['content-type'] || 'audio/ogg',
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

module.exports = { getSinchToken, getWaSinchToken, sendMessage, sendEmail, downloadMedia };
