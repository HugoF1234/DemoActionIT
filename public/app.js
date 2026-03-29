/* ══════════════════════════════════════════════════════
   LEXIA CRM — Frontend
══════════════════════════════════════════════════════ */

const socket = io();

let contacts = [];
let currentContactId = null;
let activeFilter = 'all';
let selectedChannel = 'WHATSAPP';
let searchQuery = '';

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadContacts();
  loadStats();
  bindFilters();
  bindChannelBtns();
  bindSearch();
  bindNavTabs();
  initProfile();
  initConfirmToggle();
});

// ─── Data ──────────────────────────────────────────────
async function loadContacts() {
  const res = await fetch('/api/crm/contacts');
  contacts = await res.json();
  renderList();
  if (currentContactId) renderDetail(currentContactId);
}

async function loadStats() {
  const res = await fetch('/api/crm/stats');
  const s = await res.json();
  setText('stat-clients', s.clients ?? '—');
  setText('stat-prospects', s.prospects ?? '—');
  setText('stat-messages', s.messagesThisMonth ?? '—');
  setText('stat-response', s.avgResponseTime ?? '—');
}

// ─── Contact list ──────────────────────────────────────
function renderList() {
  const list = el('contacts-list');
  let filtered = contacts.filter(c => activeFilter === 'all' || c.status === activeFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:1.5rem;font-size:0.78rem;color:var(--text-3)">Aucun contact</div>';
    return;
  }

  list.innerHTML = filtered.map(c => {
    const initials = initials2(c.name);
    const col = avatarCol(c.id);
    return `
      <div class="contact-card ${c.id === currentContactId ? 'active' : ''}" onclick="selectContact('${c.id}')">
        <div class="cc-avatar" style="background:${col}18;color:${col}">${initials}</div>
        <div class="cc-info">
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-company">${esc(c.company || '—')}</div>
        </div>
        <div class="cc-right">
          <span class="cc-time">${relTime(c.lastContact)}</span>
          <span class="cc-status s-${c.status}">${c.status}</span>
        </div>
      </div>
    `;
  }).join('');
}

function selectContact(id) {
  currentContactId = id;
  renderList();
  renderDetail(id);
}

// ─── Contact detail ────────────────────────────────────
function renderDetail(id) {
  const c = contacts.find(x => x.id === id);
  if (!c) return;

  el('empty-state').classList.add('hidden');
  el('contact-detail').classList.remove('hidden');

  const initials = initials2(c.name);
  const col = avatarCol(c.id);
  const av = el('detail-avatar');
  av.textContent = initials;
  av.style.background = col + '20';
  av.style.color = col;

  setText('detail-name', c.name);
  setText('detail-company', c.company || '—');

  const pill = el('detail-status-pill');
  pill.textContent = c.status;
  pill.className = `status-pill s-${c.status}`;

  el('detail-email').innerHTML = `${iconSvg('mail')} ${esc(c.email || '—')}`;
  el('detail-phone').innerHTML = `${iconSvg('phone')} ${esc(c.phone || '—')}`;
  el('detail-assigned').innerHTML = `${iconSvg('user')} ${esc(c.assignedTo || '—')}`;

  // Score arc
  const score = c.score || 0;
  const circ = 163;
  const offset = circ - (score / 100) * circ;
  const arc = el('score-arc');
  arc.style.strokeDashoffset = offset;
  arc.style.stroke = scoreCol(score);
  el('score-value').textContent = score;
  el('score-value').style.color = scoreCol(score);

  // Tags
  el('detail-tags').innerHTML = (c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');

  // Notes
  el('notes-area').value = c.notes || '';

  // Info list
  el('info-list').innerHTML = [
    ['Segment', c.segment || '—'],
    ['WhatsApp', c.whatsapp || '—'],
    ['Score', `${score}/100`],
    ['Interactions', (c.interactions || []).length],
    ['Créé le', fmtDate(c.createdAt)],
  ].map(([k, v]) => `
    <div class="info-row">
      <span class="info-key">${k}</span>
      <span class="info-val">${esc(String(v))}</span>
    </div>
  `).join('');

  renderInteractions(c);
}

function renderInteractions(c) {
  const list = el('interactions-list');
  const ints = c.interactions || [];
  el('interactions-count').textContent = `${ints.length} interaction${ints.length !== 1 ? 's' : ''}`;

  if (!ints.length) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:0.78rem;text-align:center;padding:1.5rem">Aucune interaction</div>';
    return;
  }

  list.innerHTML = ints.map(i => {
    const dirLabel = i.direction === 'inbound' ? 'Entrant' : 'Sortant';
    const sentClass = { positive: 'pos', very_positive: 'pos', negative: 'neg', neutral: '' }[i.sentiment] || '';
    const sentLabel = { positive: 'Positif', very_positive: 'Très positif', negative: 'Négatif', neutral: 'Neutre' }[i.sentiment] || '';
    const sentChipClass = { positive: 'sent-positive', very_positive: 'sent-positive', negative: 'sent-negative', neutral: 'sent-neutral' }[i.sentiment] || '';

    let actionsHtml = '';
    if (i.actionsDetected?.length) {
      actionsHtml = `<div class="actions-list">${i.actionsDetected.map(a =>
        `<span class="action-chip">${esc(a.type.replace(/_/g, ' '))}${a.target_contact ? ` → ${esc(a.target_contact)}` : ''}</span>`
      ).join('')}</div>`;
    }

    let transcriptHtml = '';
    if (i.isAudio && i.transcript) {
      transcriptHtml = `<div class="int-audio">Vocal: ${esc(i.transcript)}</div>`;
    }

    let aiHtml = '';
    if (i.aiSummary) {
      aiHtml = `
        <div class="ai-box">
          <div class="ai-box-header">
            <span style="font-size:0.7rem;font-weight:600">Lexia Intelligence</span>
            ${sentLabel ? `<span class="sentiment-chip ${sentChipClass}">${sentLabel}</span>` : ''}
            ${i.category ? `<span style="margin-left:auto;font-size:0.65rem;color:var(--text-3)">${esc(i.category)}</span>` : ''}
          </div>
          <span>${esc(i.aiSummary)}</span>
          ${actionsHtml}
        </div>
      `;
    }

    return `
      <div class="int-item ${i.direction}">
        <div class="int-head">
          <span class="int-badge ch-${i.type}">${esc(i.type?.toUpperCase() || '—')}</span>
          <span class="int-dir">${dirLabel}</span>
          ${i.category ? `<span class="int-cat">${esc(i.category)}</span>` : ''}
          <span class="int-time">${relTime(i.timestamp)}</span>
        </div>
        <div class="int-content">${esc(i.content || '')}</div>
        ${transcriptHtml}
        ${aiHtml}
      </div>
    `;
  }).join('');
}

// ─── Notes save ────────────────────────────────────────
async function saveNotes() {
  if (!currentContactId) return;
  const notes = el('notes-area').value;
  await fetch(`/api/crm/contacts/${currentContactId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  const c = contacts.find(x => x.id === currentContactId);
  if (c) c.notes = notes;
  toast('Notes sauvegardées');
}

// ─── Edit contact modal ────────────────────────────────
function openEditModal() {
  const c = contacts.find(x => x.id === currentContactId);
  if (!c) return;
  el('edit-name').value = c.name || '';
  el('edit-company').value = c.company || '';
  el('edit-email').value = c.email || '';
  el('edit-phone').value = c.phone || '';
  el('edit-whatsapp').value = c.whatsapp || '';
  el('edit-status').value = c.status || 'lead';
  el('edit-segment').value = c.segment || 'Standard';
  el('edit-assigned').value = c.assignedTo || '';
  el('edit-tags').value = (c.tags || []).join(', ');
  el('edit-result').className = 'edit-result hidden';
  el('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  el('edit-modal').classList.add('hidden');
}

async function saveContactEdit() {
  if (!currentContactId) return;
  const tags = el('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const updates = {
    name: el('edit-name').value.trim(),
    company: el('edit-company').value.trim(),
    email: el('edit-email').value.trim(),
    phone: el('edit-phone').value.trim(),
    whatsapp: el('edit-whatsapp').value.trim(),
    status: el('edit-status').value,
    segment: el('edit-segment').value,
    assignedTo: el('edit-assigned').value.trim(),
    tags,
  };

  try {
    await fetch(`/api/crm/contacts/${currentContactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const resultEl = el('edit-result');
    resultEl.textContent = 'Contact mis à jour avec succès.';
    resultEl.className = 'edit-result success';
    await loadContacts();
    setTimeout(closeEditModal, 1200);
  } catch (e) {
    const resultEl = el('edit-result');
    resultEl.textContent = 'Erreur lors de la mise à jour.';
    resultEl.className = 'edit-result error';
  }
}

// ─── Send message modal ────────────────────────────────
function openSendModal(contactId) {
  if (contactId && typeof contactId === 'string') {
    const c = contacts.find(x => x.id === contactId);
    if (c) el('msg-to').value = selectedChannel === 'email' ? (c.email || '') : (c.phone || c.whatsapp || '');
  }
  el('send-result').className = 'send-result hidden';
  el('send-result').textContent = '';
  el('send-modal').classList.remove('hidden');
}

function closeSendModal() {
  el('send-modal').classList.add('hidden');
}

async function sendMessage() {
  const to = el('msg-to').value.trim();
  const content = el('msg-content').value.trim();
  const resultEl = el('send-result');

  if (!to || !content) {
    resultEl.textContent = 'Veuillez remplir tous les champs.';
    resultEl.className = 'send-result error';
    return;
  }

  const btn = el('send-btn');
  btn.disabled = true;
  btn.textContent = 'Envoi...';

  try {
    let url, body;
    if (selectedChannel === 'email') {
      url = '/api/sinch/send-email';
      body = { to, subject: el('msg-subject').value || 'Message Lexia CRM', message: content };
    } else {
      url = '/api/sinch/send';
      body = { to, message: content, channel: selectedChannel };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      resultEl.textContent = `Message envoyé.${data.messageId ? ` ID: ${data.messageId}` : ''}`;
      resultEl.className = 'send-result success';

      if (currentContactId) {
        await fetch(`/api/crm/contacts/${currentContactId}/interactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: selectedChannel.toLowerCase(),
            direction: 'outbound',
            content,
            status: 'delivered',
          }),
        });
        await loadContacts();
      }
    } else {
      throw new Error(data.error || 'Erreur inconnue');
    }
  } catch (err) {
    resultEl.textContent = `Erreur: ${err.message}`;
    resultEl.className = 'send-result error';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Envoyer`;
  }
}

// ─── Simulation ────────────────────────────────────────
async function simulateInbound() {
  const channel = el('sim-channel').value;
  const from = el('sim-from').value.trim();
  const content = el('sim-content').value.trim();
  const isAudio = el('sim-is-audio').checked;
  if (!content) return;

  resetWorkflow();
  el('workflow-status').textContent = 'Traitement en cours...';

  await fetch('/webhook/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, from, content, isAudio }),
  });
}

// ─── Workflow (Socket.io) ──────────────────────────────
function resetWorkflow() {
  el('stage-source').className    = 'stage';
  el('stage-receive').className   = 'stage';
  el('stage-transcript').className = 'stage';
  el('stage-ai').className        = 'stage stage-lexia';
  el('stage-actions').className   = 'stage';
  el('stage-crm').className       = 'stage';
  ['arrow-1','arrow-2','arrow-3','arrow-4','arrow-5']
    .forEach(id => el(id).className = 'stage-arrow');
  el('stage-channel').textContent = '';
  el('stage-channel').style.cssText = '';
  ['stage-sub-source','stage-sub-receive','stage-sub-transcript',
   'stage-sub-ai','stage-sub-actions','stage-sub-crm']
    .forEach(id => el(id).textContent = '—');
  el('transcript-bubble').classList.add('hidden');
  el('ai-tags').classList.add('hidden');
  el('ai-tags').innerHTML = '';
  el('workflow-log').innerHTML = '';
}

socket.on('workflow:start', (data) => {
  resetWorkflow();
  activate('stage-source');

  const chanStyles = {
    whatsapp: { bg: 'rgba(37,211,102,0.12)', color: 'var(--wa)' },
    sms:      { bg: 'rgba(56,139,253,0.12)', color: 'var(--sms)' },
    phone:    { bg: 'rgba(188,140,255,0.12)', color: 'var(--purple)' },
    email:    { bg: 'rgba(210,153,34,0.12)', color: 'var(--mail)' },
  };
  const s = chanStyles[data.source] || { bg: 'var(--accent-bg)', color: 'var(--accent-2)' };
  const badge = el('stage-channel');
  badge.textContent = data.source.toUpperCase();
  badge.style.background = s.bg;
  badge.style.color = s.color;

  el('stage-sub-source').textContent = data.from || '—';
  el('workflow-status').textContent = `${data.source.toUpperCase()} — ${data.from}`;

  log(`Message ${data.isAudio ? 'vocal ' : ''}entrant de ${data.from} via ${data.source.toUpperCase()}`, 'info');

  el('stage-sub-receive').textContent = 'Webhook';
  setTimeout(() => { done('stage-source'); lit('arrow-1'); activate('stage-receive'); }, 500);
});

socket.on('workflow:processing', (data) => {
  done('stage-receive'); lit('arrow-2'); activate('stage-transcript');
  el('stage-sub-transcript').textContent = data.message || '...';
  log(data.message, 'info');
});

socket.on('workflow:transcribing', (data) => {
  el('stage-sub-transcript').textContent = data.message || 'Transcription...';
  log(data.message, 'ai');
});

socket.on('workflow:transcript', (data) => {
  const bubble = el('transcript-bubble');
  bubble.textContent = `"${data.transcript}"`;
  bubble.classList.remove('hidden');
  log(`Transcription: "${data.transcript}"`, 'ai');
});

socket.on('workflow:ai', (data) => {
  done('stage-transcript'); lit('arrow-3'); activate('stage-ai');
  const msg = (data.message || 'Analyse...').replace(/Lexia AI/g, 'Lexia Intelligence');
  el('stage-sub-ai').textContent = msg;
  log(msg, 'ai');
});

socket.on('workflow:ai_done', (data) => {
  const sentClass = { positive: 'pos', very_positive: 'pos', negative: 'neg' }[data.sentiment] || '';
  const aiTags = el('ai-tags');
  aiTags.classList.remove('hidden');
  aiTags.innerHTML = `
    <span class="ai-tag ${sentClass}">${data.sentiment || '—'}</span>
    <span class="ai-tag">${data.category || '—'}</span>
  `;

  const actionCount = (data.actions || []).filter(a => a.type !== 'NONE').length;
  log(`Lexia Intelligence: ${data.category}, sentiment=${data.sentiment}`, 'ai');
  log(`Résumé: ${data.summary}`, 'ai');
  if (data.transcript) log(`Transcript: "${data.transcript}"`, 'info');
  if (actionCount > 0) log(`${actionCount} action(s) détectée(s)`, 'action');
});

socket.on('workflow:action', (data) => {
  done('stage-ai'); lit('arrow-4'); activate('stage-actions');
  el('stage-sub-actions').textContent = data.detail || data.type || '—';
  log(`Action: ${data.type} — ${data.detail}`, 'action');
});

socket.on('workflow:crm_updated', (data) => {
  done('stage-actions'); lit('arrow-5'); activate('stage-crm');
  el('stage-sub-crm').textContent = data.contactName || '—';
  el('workflow-status').textContent = `CRM mis à jour — ${data.contactName}`;

  if (data.actionResults?.length) {
    data.actionResults.forEach(r => {
      log(`${r.status === 'success' ? 'OK' : 'ERR'} ${r.action}: ${r.detail || r.reason}`, r.status === 'success' ? 'success' : 'error');
    });
  } else {
    log(`Contact mis à jour: ${data.contactName}`, 'success');
  }

  setTimeout(() => done('stage-crm'), 800);
});

socket.on('crm:refresh', () => { loadContacts(); loadStats(); });

// Sync toggle from server-side changes (e.g. via voice command)
socket.on('settings:updated', data => {
  if (data.confirmBeforeAction !== undefined) {
    confirmBeforeAction = !!data.confirmBeforeAction;
    localStorage.setItem('lexia_confirm_action', String(confirmBeforeAction));
    syncToggleUI();
    toast(confirmBeforeAction ? 'Confirmation activée' : 'Mode direct activé');
  }
});

socket.on('workflow:error', (data) => {
  log(`Erreur: ${data.message}`, 'error');
  el('workflow-status').textContent = 'Erreur';
});

// ─── Bindings ──────────────────────────────────────────
function bindFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderList();
    });
  });
}

function bindChannelBtns() {
  document.querySelectorAll('.chan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chan-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedChannel = btn.dataset.chan;
      const subjectGrp = el('subject-group');
      subjectGrp.classList.toggle('hidden', selectedChannel !== 'email');
    });
  });
}

function bindSearch() {
  el('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderList();
  });
}

document.getElementById('send-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSendModal(); });
document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });
document.getElementById('new-contact-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeNewContactModal(); });

// ─── Push-to-Talk (spacebar) ───────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let pttStream = null;
let pttActive = false;

function pttSetRecording(active) {
  const panel = document.querySelector('.workflow-panel');
  if (active) {
    panel?.classList.add('recording');
  } else {
    panel?.classList.remove('recording');
  }
}

async function pttStart() {
  if (pttActive) return;
  pttActive = true;

  try {
    pttStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

    mediaRecorder = new MediaRecorder(pttStream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      pttStream.getTracks().forEach(t => t.stop());
      pttActive = false;
      if (!audioChunks.length) { pttReset(); return; }

      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      audioChunks = [];

      const formData = new FormData();
      formData.append('audio', blob, 'ptt.webm');

      try {
        await fetch('/api/ptt', { method: 'POST', body: formData });
      } catch (err) {
        console.error('PTT send error:', err);
        setTimeout(pttReset, 2500);
      }
    };

    mediaRecorder.start(100);
    pttSetRecording(true);

  } catch (err) {
    console.error('Microphone error:', err);
    pttActive = false;
    pttReset();
  }
}

function pttStop() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    pttActive = false;
    return;
  }
  pttSetRecording(false);
  mediaRecorder.stop();
}

function pttReset() {
  document.querySelector('.workflow-panel')?.classList.remove('recording');
}

// Spacebar bindings — prevent scroll, only fire when no input focused
document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  e.preventDefault();
  if (!e.repeat) pttStart();
});

document.addEventListener('keyup', e => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  pttStop();
});

socket.on('ptt:transcript', data => {
  log(`PTT: "${data.transcript.slice(0, 60)}${data.transcript.length > 60 ? '…' : ''}"`, 'info');
});

socket.on('ptt:done', data => {
  pttReset();
});

socket.on('ptt:error', () => {
  setTimeout(pttReset, 2000);
});

// ─── New Contact Modal ─────────────────────────────────
function openNewContactModal() {
  // Clear all fields
  ['nc-firstname','nc-lastname','nc-email','nc-phone','nc-company','nc-whatsapp','nc-assigned','nc-tags','nc-notes'].forEach(id => {
    const e = el(id); if (e) e.value = '';
  });
  el('nc-status').value = 'lead';
  el('nc-segment').value = 'Standard';
  el('nc-score').value = '';
  el('nc-result').className = 'send-result hidden';
  el('new-contact-modal').classList.remove('hidden');
}

function closeNewContactModal() {
  el('new-contact-modal').classList.add('hidden');
}

async function createContact() {
  const firstName = el('nc-firstname').value.trim();
  const lastName = el('nc-lastname').value.trim();
  const email = el('nc-email').value.trim();
  const phone = el('nc-phone').value.trim();
  const resultEl = el('nc-result');

  // Validate required fields
  const errors = [];
  if (!firstName) errors.push('Prénom');
  if (!lastName) errors.push('Nom');
  if (!email || !email.includes('@')) errors.push('Email valide');
  if (!phone) errors.push('Téléphone');

  if (errors.length) {
    resultEl.textContent = `Champs requis manquants: ${errors.join(', ')}`;
    resultEl.className = 'send-result error';
    return;
  }

  const tags = el('nc-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const score = parseInt(el('nc-score').value) || 50;

  const payload = {
    name: `${firstName} ${lastName}`,
    email,
    phone,
    whatsapp: el('nc-whatsapp').value.trim() || phone,
    company: el('nc-company').value.trim(),
    status: el('nc-status').value,
    segment: el('nc-segment').value,
    assignedTo: el('nc-assigned').value.trim() || 'Non assigné',
    score: Math.min(100, Math.max(0, score)),
    tags,
    notes: el('nc-notes').value.trim(),
  };

  try {
    const res = await fetch('/api/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const newContact = await res.json();

    resultEl.textContent = `Contact "${newContact.name}" créé avec succès.`;
    resultEl.className = 'send-result success';

    await loadContacts();
    setTimeout(() => {
      closeNewContactModal();
      selectContact(newContact.id);
    }, 1000);
  } catch (err) {
    resultEl.textContent = `Erreur: ${err.message}`;
    resultEl.className = 'send-result error';
  }
}

// ─── Workflow helpers ──────────────────────────────────
function activate(id) {
  const e = el(id);
  const extra = id === 'stage-ai' ? ' stage-lexia' : '';
  e.className = 'stage active' + extra;
}
function done(id) {
  const e = el(id);
  const extra = id === 'stage-ai' ? ' stage-lexia' : '';
  e.className = 'stage done' + extra;
}
function lit(id) { el(id).className = 'stage-arrow lit'; }

function log(text, type = 'info') {
  const logEl = el('workflow-log');
  const d = document.createElement('div');
  const t = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  d.className = `log-entry log-${type}`;
  d.textContent = `[${t}] ${text}`;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

// ─── Helpers ───────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initials2(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function avatarCol(id) {
  const colors = ['#5865f2','#3fb950','#d29922','#f85149','#388bfd','#bc8cff','#2dd4bf','#f472b6'];
  let h = 0;
  for (const c of (id || '')) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
}

function scoreCol(s) {
  return s >= 75 ? 'var(--green)' : s >= 50 ? 'var(--yellow)' : 'var(--red)';
}

function relTime(iso) {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), j = Math.floor(h / 24);
  if (m < 1) return 'Maintenant';
  if (m < 60) return `${m}min`;
  if (h < 24) return `${h}h`;
  if (j < 7) return `${j}j`;
  return fmtDate(iso);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function iconSvg(type) {
  const icons = {
    mail: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    phone: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.41 2 2 0 0 1 3.59 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.07 6.07l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 17z"/></svg>`,
    user: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  };
  return icons[type] || '';
}

function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:calc(var(--workflow-h) + 12px);right:16px;background:var(--green);color:#fff;padding:6px 14px;border-radius:6px;font-size:0.78rem;z-index:600;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ─── Navigation tabs ───────────────────────────────────
const PAGES = ['contacts', 'messages', 'analytics', 'admin'];

function bindNavTabs() {
  document.querySelectorAll('.nav-tab[data-page]').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });
}

function switchPage(page) {
  document.querySelectorAll('.nav-tab[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (page === 'contacts') {
    PAGES.filter(p => p !== 'contacts').forEach(p => {
      const v = el('page-' + p); if (v) v.classList.add('hidden');
    });
    return;
  }

  PAGES.filter(p => p !== 'contacts').forEach(p => {
    const v = el('page-' + p);
    if (!v) return;
    v.classList.toggle('hidden', p !== page);
  });

  if (page === 'messages') renderMessagesPage();
  if (page === 'analytics') renderAnalyticsPage();
  if (page === 'admin') renderAdminPage();
}

async function renderMessagesPage() {
  const grid = el('messages-grid');
  if (!grid) return;
  const res = await fetch('/api/crm/contacts');
  const all = await res.json();

  const msgs = [];
  all.forEach(c => {
    (c.interactions || []).forEach(i => {
      msgs.push({ contact: c, interaction: i });
    });
  });
  msgs.sort((a, b) => new Date(b.interaction.timestamp) - new Date(a.interaction.timestamp));

  if (!msgs.length) {
    grid.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-3)">Aucun message</div>';
    return;
  }

  grid.innerHTML = msgs.slice(0, 60).map(({ contact: c, interaction: i }) => {
    const col = avatarCol(c.id);
    const inits = initials2(c.name);
    const typeLabel = (i.type || 'sms').toUpperCase();
    const dirIcon = i.direction === 'inbound' ?
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 7 17 7 17 17"/><polyline points="7 17 17 7"/></svg>' :
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 17 7 17 7 7"/><polyline points="17 7 7 17"/></svg>';
    const preview = i.isAudio ? `[Audio] ${i.transcript || ''}` : (i.content || '');
    return `
      <div class="msg-row" onclick="switchPage('contacts'); setTimeout(()=>selectContact('${c.id}'),50)">
        <div class="msg-avatar" style="background:${col}18;color:${col}">${inits}</div>
        <div class="msg-info">
          <div class="msg-name">${esc(c.name)} <span style="font-size:0.65rem;color:var(--text-3);font-weight:400">${esc(c.company || '')}</span></div>
          <div class="msg-preview">${esc(preview)}</div>
        </div>
        <div class="msg-meta">
          <span class="msg-time">${relTime(i.timestamp)}</span>
          <span class="int-badge ch-${i.type || 'sms'}" style="font-size:0.6rem">${dirIcon} ${typeLabel}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function renderAnalyticsPage() {
  const res = await fetch('/api/crm/stats');
  const s = await res.json();
  setText('an-total', s.totalContacts ?? '—');
  setText('an-messages', s.messagesThisMonth ?? '—');
  setText('an-response', s.avgResponseTime ?? '—');
  setText('an-satisfaction', s.satisfactionScore ? `${s.satisfactionScore}/5` : '—');

  const total = (s.clients || 0) + (s.prospects || 0) + (s.leads || 0) || 1;
  const setBar = (id, count) => {
    const bar = el(id);
    if (bar) bar.style.width = `${Math.round((count / total) * 100)}%`;
  };
  setBar('an-bar-client', s.clients || 0);
  setBar('an-bar-prospect', s.prospects || 0);
  setBar('an-bar-lead', s.leads || 0);
  setText('an-count-client', s.clients ?? '—');
  setText('an-count-prospect', s.prospects ?? '—');
  setText('an-count-lead', s.leads ?? '—');
}

function renderAdminPage() {
  const p = getProfile();
  const nameParts = (p.name || '').split(' ');
  const fnEl = el('admin-firstname');
  const lnEl = el('admin-lastname');
  const emEl = el('admin-email');
  if (fnEl) fnEl.value = nameParts[0] || '';
  if (lnEl) lnEl.value = nameParts.slice(1).join(' ') || '';
  if (emEl) emEl.value = p.email || '';
  syncToggleUI();
}

// ─── Profile management ────────────────────────────────
function getProfile() {
  try { return JSON.parse(localStorage.getItem('lexia_profile') || '{}'); }
  catch { return {}; }
}

function setProfile(data) {
  localStorage.setItem('lexia_profile', JSON.stringify(data));
}

function initProfile() {
  const p = getProfile();
  const name = p.name || 'Hugo Fouan';
  if (!p.name) setProfile({ name, email: '' });
  updateAvatarDisplay(name);
  syncProfileToServer(name);
}

function updateAvatarDisplay(name) {
  const parts = (name || '').trim().split(' ');
  const inits = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  const av = el('profile-avatar');
  if (av) av.textContent = inits.toUpperCase() || 'U';
}

async function syncProfileToServer(name) {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileName: name }),
    });
  } catch {}
}

function openProfileModal() {
  const p = getProfile();
  const parts = (p.name || '').split(' ');
  const fnEl = el('profile-firstname');
  const lnEl = el('profile-lastname');
  const emEl = el('profile-email-input');
  if (fnEl) fnEl.value = parts[0] || '';
  if (lnEl) lnEl.value = parts.slice(1).join(' ') || '';
  if (emEl) emEl.value = p.email || '';
  const r = el('profile-result');
  if (r) r.className = 'send-result hidden';
  el('profile-modal').classList.remove('hidden');
}

function closeProfileModal() {
  el('profile-modal').classList.add('hidden');
}

async function saveProfile() {
  const firstName = (el('admin-firstname') || el('profile-firstname'))?.value?.trim() || '';
  const lastName = (el('admin-lastname') || el('profile-lastname'))?.value?.trim() || '';
  const email = (el('admin-email') || el('profile-email-input'))?.value?.trim() || '';

  if (el('profile-firstname')) {
    const fn = el('profile-firstname').value.trim();
    const ln = el('profile-lastname').value.trim();
    const em = el('profile-email-input').value.trim();
    if (fn) {
      const name = `${fn} ${ln}`.trim();
      setProfile({ name, email: em });
      updateAvatarDisplay(name);
      await syncProfileToServer(name);
      const r = el('profile-result');
      if (r) { r.textContent = 'Profil sauvegardé'; r.className = 'send-result success'; }
      setTimeout(closeProfileModal, 1000);
      return;
    }
  }

  if (firstName) {
    const name = `${firstName} ${lastName}`.trim();
    setProfile({ name, email });
    updateAvatarDisplay(name);
    await syncProfileToServer(name);
    const r = el('admin-result');
    if (r) { r.textContent = 'Profil sauvegardé'; r.className = 'admin-result success'; r.classList.remove('hidden'); }
    setTimeout(() => { if (r) r.classList.add('hidden'); }, 2500);
  }
}

// ─── Confirm before action toggle ─────────────────────
let confirmBeforeAction = false;

async function initConfirmToggle() {
  // Read local state first (instant UI)
  confirmBeforeAction = localStorage.getItem('lexia_confirm_action') === 'true';
  syncToggleUI();

  // Then sync TO server (server resets on restart/redeploy)
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmBeforeAction }),
    });
  } catch {}

  // Also read server state and reconcile (server could have been changed via voice command)
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    // Only override if server was explicitly changed via voice (different from localStorage)
    // Voice commands update both server AND localStorage via socket event, so this is fine
  } catch {}
}

function syncToggleUI() {
  ['confirm-toggle', 'confirm-toggle-admin'].forEach(id => {
    const t = el(id);
    if (t) t.classList.toggle('on', confirmBeforeAction);
  });
  const statusText = confirmBeforeAction
    ? 'Activé — confirmation demandée sur Telegram'
    : 'Désactivé — actions immédiates';
  ['confirm-status', 'confirm-status-admin'].forEach(id => setText(id, statusText));
}

async function toggleConfirmBeforeAction() {
  confirmBeforeAction = !confirmBeforeAction;
  localStorage.setItem('lexia_confirm_action', String(confirmBeforeAction));
  syncToggleUI();
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmBeforeAction }),
    });
  } catch {}
  toast(confirmBeforeAction ? 'Confirmation activée' : 'Confirmation désactivée');
}

