const express = require('express');
const router = express.Router();
const { sendMessage, sendEmail } = require('../utils/sinch-client');

router.post('/send', async (req, res) => {
  const { to, message, channel } = req.body;
  if (!to || !message || !channel) {
    return res.status(400).json({ error: 'Champs requis: to, message, channel' });
  }
  try {
    const data = await sendMessage(to, message, channel);
    res.json({ success: true, messageId: data.message_id });
  } catch (error) {
    console.error('Send error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Échec envoi', details: error.response?.data || error.message });
  }
});

router.post('/send-email', async (req, res) => {
  const { to, subject, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Champs requis: to, message' });
  }
  try {
    const data = await sendEmail(to, subject, message);
    res.json({ success: true, messageId: data.id });
  } catch (error) {
    console.error('Email error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Échec email', details: error.response?.data || error.message });
  }
});

module.exports = router;
