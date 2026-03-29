const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_PATH = path.join(__dirname, '../data/crm-data.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/contacts', (req, res) => {
  const data = loadData();
  res.json(data.contacts);
});

router.get('/contacts/:id', (req, res) => {
  const data = loadData();
  const contact = data.contacts.find((c) => c.id === req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  res.json(contact);
});

router.post('/contacts', (req, res) => {
  const data = loadData();
  const newContact = {
    id: `c${uuidv4().slice(0, 6)}`,
    name: req.body.name || 'Nouveau contact',
    company: req.body.company || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    whatsapp: req.body.whatsapp || req.body.phone || '',
    status: req.body.status || 'lead',
    segment: req.body.segment || 'Standard',
    score: req.body.score || 50,
    assignedTo: req.body.assignedTo || 'Non assigné',
    tags: req.body.tags || [],
    lastContact: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    notes: req.body.notes || '',
    interactions: [],
  };
  data.contacts.unshift(newContact);
  saveData(data);
  res.json(newContact);
});

router.patch('/contacts/:id', (req, res) => {
  const data = loadData();
  const idx = data.contacts.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Contact not found' });

  data.contacts[idx] = { ...data.contacts[idx], ...req.body };
  data.contacts[idx].lastContact = new Date().toISOString();
  saveData(data);
  res.json(data.contacts[idx]);
});

router.post('/contacts/:id/interactions', (req, res) => {
  const data = loadData();
  const contact = data.contacts.find((c) => c.id === req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const interaction = {
    id: `i${uuidv4().slice(0, 6)}`,
    type: req.body.type || 'sms',
    direction: req.body.direction || 'outbound',
    content: req.body.content || '',
    timestamp: new Date().toISOString(),
    status: req.body.status || 'sent',
    sentiment: req.body.sentiment || null,
    category: req.body.category || null,
    aiSummary: req.body.aiSummary || null,
  };

  contact.interactions.unshift(interaction);
  contact.lastContact = new Date().toISOString();
  saveData(data);
  res.json(interaction);
});

router.get('/stats', (req, res) => {
  const data = loadData();
  res.json(data.stats);
});

module.exports = router;
