require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const crmRoutes = require('./routes/crm');
const sinchRoutes = require('./routes/sinch');
const webhookRoutes = require('./routes/webhook');
const pttRoutes = require('./routes/ptt');
const telegramRoutes = require('./routes/telegram');
const settings = require('./utils/settings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.set('io', io);
app.locals.settings = settings;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/crm', crmRoutes);
app.use('/api/sinch', sinchRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/ptt', pttRoutes);
app.use('/telegram', telegramRoutes);

app.get('/api/settings', (req, res) => res.json(settings));

app.post('/api/settings', (req, res) => {
  const { profileName, confirmBeforeAction } = req.body;
  if (profileName !== undefined) {
    settings.profileName = profileName.trim().split(' ')[0] || profileName.trim();
  }
  if (confirmBeforeAction !== undefined) settings.confirmBeforeAction = !!confirmBeforeAction;
  res.json({ ok: true, settings });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nLexia CRM Demo running at http://localhost:${PORT}`);
  console.log(`Sinch webhook:    http://localhost:${PORT}/webhook/sinch`);
  console.log(`Telegram webhook: http://localhost:${PORT}/telegram/webhook`);
  console.log(`Telegram setup:   http://localhost:${PORT}/telegram/setup?url=TUNNEL_URL`);
  console.log(`API:              http://localhost:${PORT}/api/crm/contacts\n`);
});

