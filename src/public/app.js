/* Clip Factory — Dashboard (vanilla JS) */

'use strict';

// ── Estado ────────────────────────────────────────────────────────────────
let currentJobId = null;
let jobPollInterval = null;
let transcriptionWords = [];

// ── Utilitários ───────────────────────────────────────────────────────────

/** Escapa string para inserção segura no DOM (anti-XSS) */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str != null ? String(str) : '';
  return d.innerHTML;
}

function fmt(seconds) {
  const s = Math.round(parseFloat(seconds) || 0);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function dur(start, end) {
  const d = Math.round(parseFloat(end) - parseFloat(start));
  return d >= 60 ? `${Math.floor(d/60)}m${d%60}s` : `${d}s`;
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = '/login.html'; return null; }
  return res.json();
}

// ── Progresso ─────────────────────────────────────────────────────────────

const STEPS = {
  pending:      [],
  downloading:  ['step-downloading'],
  downloaded:   ['step-downloading'],
  transcribing: ['step-downloading', 'step-transcribing'],
  transcribed:  ['step-downloading', 'step-transcribing'],
  analyzing:    ['step-downloading', 'step-transcribing', 'step-analyzing'],
  analyzed:     ['step-downloading', 'step-transcribing', 'step-analyzing', 'step-analyzed'],
  failed:       [],
};

const STATUS_LABELS = {
  pending:      'Aguardando início...',
  downloading:  'Baixando vídeo do YouTube...',
  downloaded:   'Download concluído. Iniciando transcrição...',
  transcribing: 'Transcrevendo áudio (pode levar alguns minutos)...',
  transcribed:  'Transcrição concluída. Analisando com IA...',
  analyzing:    'IA identificando os melhores momentos...',
  analyzed:     'Análise concluída! Revise as sugestões abaixo.',
  failed:       'Ocorreu um erro. Tente novamente.',
};

function updateProgress(status, errorMessage) {
  const bar = document.getElementById('status-bar');
  bar.classList.add('visible');

  document.getElementById('status-text').textContent =
    status === 'failed' && errorMessage
      ? `Erro: ${errorMessage}`
      : (STATUS_LABELS[status] || status);

  const activeSteps = STEPS[status] || [];
  ['step-downloading','step-transcribing','step-analyzing','step-analyzed'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('active','done');
    if (activeSteps.includes(id)) {
      el.classList.add(id === activeSteps[activeSteps.length - 1] ? 'active' : 'done');
    }
  });
}

// ── Polling de job ─────────────────────────────────────────────────────────

function stopPolling() {
  if (jobPollInterval) { clearInterval(jobPollInterval); jobPollInterval = null; }
}

async function pollJob(jobId) {
  const job = await api('GET', `/api/jobs/${jobId}`);
  if (!job) return;

  updateProgress(job.status, job.error_message);

  if (job.status === 'analyzed') {
    stopPolling();
    await loadSuggestions(jobId);
    return;
  }

  if (job.status === 'failed') {
    stopPolling();
    document.getElementById('submit-btn').disabled = false;
    return;
  }
}

function startPolling(jobId) {
  stopPolling();
  pollJob(jobId);
  jobPollInterval = setInterval(() => pollJob(jobId), 5000);
}

// ── Sugestões ──────────────────────────────────────────────────────────────

function getTranscriptSnippet(startTime, endTime) {
  if (!transcriptionWords.length) return '';
  const startMs = parseFloat(startTime) * 1000;
  const endMs   = parseFloat(endTime) * 1000;
  const words = transcriptionWords
    .filter(w => w.start >= startMs && w.end <= endMs)
    .map(w => w.text)
    .join(' ');
  return words.length > 200 ? words.substring(0, 200) + '…' : words;
}

async function loadSuggestions(jobId) {
  // Carrega transcrição para preview
  const tx = await api('GET', `/api/jobs/${jobId}/transcription`);
  if (tx && Array.isArray(tx.words)) transcriptionWords = tx.words;

  const data = await api('GET', `/api/jobs/${jobId}/suggestions`);
  if (!data || !data.suggestions) return;

  const section = document.getElementById('suggestions-section');
  const list = document.getElementById('suggestions-list');
  const title = document.getElementById('suggestions-title');

  const { suggestions } = data;
  const videos = suggestions.filter(s => s.type === 'video').length;
  const reels  = suggestions.filter(s => s.type === 'reel').length;
  title.textContent = `${suggestions.length} sugestões — ${videos} vídeos, ${reels} reels`;

  list.innerHTML = '';
  if (!suggestions.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma sugestão gerada.</div>';
  } else {
    suggestions.forEach(s => list.appendChild(buildSuggestionCard(s)));
  }

  section.style.display = 'block';
}

function buildSuggestionCard(s) {
  const card = document.createElement('div');
  card.className = `suggestion-card ${s.status}`;
  card.id = `suggestion-${s.id}`;

  const snippet = getTranscriptSnippet(s.start_time, s.end_time);
  const isDecided = s.status === 'approved' || s.status === 'rejected';

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">${esc(s.title)}</div>
      <div class="card-meta">
        <span class="badge badge-${s.type}">${s.type === 'video' ? 'VÍDEO' : 'REEL'}</span>
        <span class="timestamps">${fmt(s.start_time)} → ${fmt(s.end_time)} (${dur(s.start_time, s.end_time)})</span>
      </div>
    </div>
    ${s.reason ? `<div class="card-reason">${esc(s.reason)}</div>` : ''}
    ${snippet   ? `<div class="card-transcript">${esc(snippet)}</div>` : ''}
    <div class="card-actions" id="actions-${s.id}">
      ${isDecided
        ? renderDecidedActions(s)
        : `<button class="btn btn-success btn-sm" onclick="decideSuggestion(${s.id},'approved',this)">✓ Aprovar</button>
           <button class="btn btn-danger btn-sm"  onclick="decideSuggestion(${s.id},'rejected',this)">✗ Rejeitar</button>`
      }
    </div>
  `;
  return card;
}

function renderDecidedActions(s) {
  if (s.status === 'rejected') return '<span class="clip-status">Rejeitado</span>';
  return `<span class="clip-status" id="clip-status-${s.id}">Aguardando corte...</span>`;
}

// ── Aprovar / Rejeitar ─────────────────────────────────────────────────────

async function decideSuggestion(id, status, btn) {
  btn.disabled = true;
  const other = btn.parentElement.querySelector(status === 'approved' ? '.btn-danger' : '.btn-success');
  if (other) other.disabled = true;

  const result = await api('PATCH', `/api/suggestions/${id}`, { status });
  if (!result) return;

  const card = document.getElementById(`suggestion-${id}`);
  card.className = `suggestion-card ${status}`;

  const actions = document.getElementById(`actions-${id}`);
  actions.innerHTML = renderDecidedActions({ id, status });

  if (status === 'approved') {
    pollClipStatus(id, result.id);
  }
}

// ── Poll clip ──────────────────────────────────────────────────────────────

async function pollClipStatus(suggestionId, clipId) {
  const statusEl = document.getElementById(`clip-status-${suggestionId}`);
  if (!statusEl) return;

  // Busca o clip_id associado à sugestão se não passado
  if (!clipId) {
    // O clip é criado pelo worker — aguarda até 10s antes de fazer poll
    await new Promise(r => setTimeout(r, 3000));
  }

  let attempts = 0;
  const poll = async () => {
    attempts++;
    // Busca clips da sugestão via jobs
    const actionsEl = document.getElementById(`actions-${suggestionId}`);
    if (!actionsEl) return;

    if (!clipId) {
      // Tenta encontrar o clip pelo job (simplificado: usa o currentJobId)
      const data = await api('GET', `/api/jobs/${currentJobId}/suggestions`);
      if (data) {
        const s = data.suggestions.find(x => x.id === suggestionId);
        // Clip ainda sendo criado pelo worker
      }
      if (attempts > 30) { clearInterval(poller); return; }
      return;
    }

    const clip = await api('GET', `/api/clips/${clipId}`);
    if (!clip) { clearInterval(poller); return; }

    if (clip.status === 'cutting') {
      statusEl.textContent = '✂️ Cortando...';
      return;
    }

    clearInterval(poller);

    if (clip.status === 'ready') {
      statusEl.className = 'clip-status ready';
      statusEl.textContent = '✓ Pronto!';
      actionsEl.appendChild(buildUploadForm(clip, suggestionId));
      return;
    }

    if (clip.status === 'failed') {
      statusEl.textContent = '❌ Falha no corte';
    }
  };

  const poller = setInterval(poll, 5000);
  poll();
}

// ── Upload Form ────────────────────────────────────────────────────────────

function buildUploadForm(clip, suggestionId) {
  const card = document.getElementById(`suggestion-${suggestionId}`);
  const titleEl = card.querySelector('.card-title');
  const defaultTitle = titleEl ? titleEl.textContent : '';

  const form = document.createElement('div');
  form.className = 'upload-form';
  form.id = `upload-form-${suggestionId}`;
  form.innerHTML = `
    <div class="upload-form-title">📅 Agendar publicação</div>
    <div class="upload-row">
      <div class="form-group">
        <label>Título</label>
        <input type="text" id="upload-title-${suggestionId}" value="${esc(defaultTitle)}" maxlength="100">
      </div>
      <div class="form-group">
        <label>Agendar para</label>
        <input type="datetime-local" id="upload-date-${suggestionId}">
      </div>
    </div>
    <div class="form-group" style="margin-top:10px">
      <label>Descrição</label>
      <textarea id="upload-desc-${suggestionId}" rows="2" placeholder="Descrição opcional..."></textarea>
    </div>
    <button class="btn btn-primary btn-sm" style="margin-top:8px"
      onclick="scheduleUpload(${clip.id}, ${suggestionId})">Agendar Upload</button>
    <span class="clip-status" id="upload-status-${suggestionId}"></span>
  `;
  return form;
}

async function scheduleUpload(clipId, suggestionId) {
  const title = document.getElementById(`upload-title-${suggestionId}`).value.trim();
  const desc  = document.getElementById(`upload-desc-${suggestionId}`).value.trim();
  const date  = document.getElementById(`upload-date-${suggestionId}`).value;
  const statusEl = document.getElementById(`upload-status-${suggestionId}`);

  if (!title) { statusEl.textContent = 'Título obrigatório'; return; }

  statusEl.textContent = 'Agendando...';

  const result = await api('POST', '/api/uploads', {
    clip_id: clipId,
    title,
    description: desc,
    scheduled_at: date ? new Date(date).toISOString() : null,
  });

  if (result && !result.error) {
    statusEl.className = 'clip-status ready';
    statusEl.textContent = '✓ Agendado!';
    document.getElementById(`upload-form-${suggestionId}`).querySelector('button').disabled = true;
  } else {
    statusEl.textContent = result?.error || 'Erro ao agendar';
  }
}

// ── Form submit ────────────────────────────────────────────────────────────

document.getElementById('url-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;

  stopPolling();
  transcriptionWords = [];
  document.getElementById('suggestions-section').style.display = 'none';
  document.getElementById('suggestions-list').innerHTML = '';
  updateProgress('pending');

  const job = await api('POST', '/api/jobs', { url });
  if (!job || job.error) {
    document.getElementById('status-text').textContent = job?.error || 'Erro ao criar job';
    btn.disabled = false;
    return;
  }

  currentJobId = job.id;
  startPolling(job.id);
  btn.disabled = false;
});
