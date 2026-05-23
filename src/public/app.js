/* Clip Factory — Dashboard (vanilla JS) */

'use strict';

// ── YouTube Status ────────────────────────────────────────────────────────

async function checkYouTubeStatus() {
  const el = document.getElementById('yt-status');
  if (!el) return;

  const data = await api('GET', '/auth/youtube/status');
  if (!data) return;

  const STATES = {
    connected:      { label: 'YouTube',          cls: 'connected',      href: null },
    expired:        { label: '⚠ Token expirado', cls: 'expired',        href: '/auth/youtube' },
    disconnected:   { label: 'Conectar YouTube', cls: 'disconnected',   href: '/auth/youtube' },
    not_configured: { label: 'YT não config.',   cls: 'not-configured', href: null },
  };

  const cfg = STATES[data.status] || STATES.disconnected;
  el.className = `yt-status ${cfg.cls}`;
  el.innerHTML = cfg.href
    ? `<a href="${cfg.href}" class="yt-status-link"><span class="yt-dot"></span>${cfg.label}</a>`
    : `<span class="yt-dot"></span>${cfg.label}`;

  // Banner de alerta persistente quando token expirado
  const existingBanner = document.getElementById('yt-expired-banner');
  if (data.status === 'expired' || data.status === 'disconnected') {
    if (!existingBanner) {
      const banner = document.createElement('div');
      banner.id = 'yt-expired-banner';
      banner.className = 'yt-expired-banner';
      banner.innerHTML = '⚠️ Token do YouTube expirado — uploads pausados. <a href="/auth/youtube">Reautenticar agora</a>';
      document.querySelector('main').prepend(banner);
    }
  } else if (existingBanner) {
    existingBanner.remove();
  }
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-visible'), 10);
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 300); }, 4000);
}

// Trata redirect do OAuth YouTube
(function handleOAuthRedirect() {
  const params = new URLSearchParams(location.search);
  const result = params.get('youtube_auth');
  if (!result) return;
  history.replaceState({}, '', location.pathname);
  if (result === 'success') showToast('YouTube conectado com sucesso!', 'success');
  else showToast('Falha ao conectar o YouTube. Tente novamente.', 'error');
})();

checkYouTubeStatus();

// ── Estado ────────────────────────────────────────────────────────────────
let currentJobId = null;
let currentJob = null;
let jobPollInterval = null;
let transcriptionWords = [];
let selectedContentType = 'auto';

// Paleta de cores por clip_category (LoL)
const CATEGORY_COLORS = {
  highlight:   { bg: '#C89B3C', text: '#1a1a1a' },
  educational: { bg: '#0BC4E3', text: '#1a1a1a' },
  funny:       { bg: '#1E9E5E', text: '#fff' },
};

// ── Seletor de content type ───────────────────────────────────────────────
function updateSummonerFieldsVisibility() {
  const el = document.getElementById('summoner-fields');
  if (el) el.style.display = selectedContentType === 'lol-esports' ? 'block' : 'none';
}

document.querySelectorAll('.btn-content-type').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-content-type').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedContentType = btn.dataset.type;
    updateSummonerFieldsVisibility();
  });
});

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
  const stepIds = ['step-downloading','step-transcribing','step-analyzing','step-analyzed'];
  const connIds = ['conn-1','conn-2','conn-3'];

  stepIds.forEach((id, idx) => {
    const el = document.getElementById(id);
    el.classList.remove('active','done');
    if (activeSteps.includes(id)) {
      const isLast = id === activeSteps[activeSteps.length - 1];
      el.classList.add(isLast ? 'active' : 'done');
    }
    // connectors
    const conn = document.getElementById(connIds[idx]);
    if (conn) {
      conn.className = 'step-connector';
      const prevStep = stepIds[idx]; // connector after this step
      if (activeSteps.includes(prevStep) && prevStep !== activeSteps[activeSteps.length - 1]) {
        conn.classList.add('done');
      } else if (activeSteps.includes(prevStep)) {
        conn.classList.add('active');
      }
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
    currentJob = job;
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

async function loadSuggestions(jobId, category) {
  try {
  // Carrega transcrição para preview (apenas na primeira carga, sem filtro)
  if (!category) {
    const tx = await api('GET', `/api/jobs/${jobId}/transcription`);
    if (tx && Array.isArray(tx.words)) transcriptionWords = tx.words;
  }

  const url = category
    ? `/api/jobs/${jobId}/suggestions?category=${encodeURIComponent(category)}`
    : `/api/jobs/${jobId}/suggestions`;
  const data = await api('GET', url);
  // eslint-disable-next-line no-console
  console.log('[loadSuggestions] data:', data);
  if (!data || !data.suggestions) return;

  const section = document.getElementById('suggestions-section');
  const list = document.getElementById('suggestions-list');
  const title = document.getElementById('suggestions-title');
  const filtersEl = document.getElementById('category-filters');

  const { suggestions } = data;
  const videos = suggestions.filter(s => s.type === 'video').length;
  const reels  = suggestions.filter(s => s.type === 'reel').length;
  title.textContent = `${suggestions.length} sugestões — ${videos} vídeos, ${reels} reels`;

  // Filtros de categoria (apenas lol-esports)
  if (filtersEl) {
    if (currentJob && currentJob.content_type === 'lol-esports') {
      filtersEl.innerHTML = renderCategoryFilters(jobId, category);
      filtersEl.style.display = 'flex';
    } else {
      filtersEl.style.display = 'none';
    }
  }

  list.innerHTML = '';
  if (!suggestions.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma sugestão para esta categoria.</div>';
  } else {
    suggestions.forEach(s => list.appendChild(buildSuggestionCard(s)));
  }

  section.style.display = 'block';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[loadSuggestions] erro:', err);
  }
}

function renderCategoryFilters(jobId, activeCategory) {
  const categories = [
    { value: '', label: 'Todos' },
    { value: 'highlight', label: 'Highlight' },
    { value: 'educational', label: 'Educational' },
    { value: 'funny', label: 'Funny' },
  ];
  return categories.map(({ value, label }) => {
    const isActive = (activeCategory || '') === value;
    const onclickArg = value ? `'${value}'` : 'undefined';
    return `<button class="btn-category-filter${isActive ? ' active' : ''}" onclick="loadSuggestions(${jobId}, ${onclickArg})">${label}</button>`;
  }).join('');
}

function buildSuggestionCard(s) {
  const card = document.createElement('div');
  card.className = `suggestion-card ${s.status}`;
  card.id = `suggestion-${s.id}`;
  card.dataset.suggestionTitle = s.title;

  const snippet = getTranscriptSnippet(s.start_time, s.end_time);
  const isDecided = s.status === 'approved' || s.status === 'rejected';
  const catColors = s.clip_category && CATEGORY_COLORS[s.clip_category];
  const categoryBadge = catColors
    ? `<span class="category-badge" style="background:${catColors.bg};color:${catColors.text}">${esc(s.clip_category)}</span>`
    : '';

  // SEO Squad: dados otimizados (prioridade sobre sugestão bruta do GPT)
  const hasSEO = !!(s.seo_score || s.seo_title);
  const activeTags = hasSEO
    ? (Array.isArray(s.seo_tags) ? s.seo_tags : [])
    : (Array.isArray(s.suggested_tags) ? s.suggested_tags : null);
  const activeDesc = hasSEO ? s.seo_description : s.suggested_description;

  const seoScoreCls = s.seo_score >= 70 ? 'high' : s.seo_score >= 50 ? 'mid' : 'low';
  const seoBadgeHtml = s.seo_score
    ? `<span class="seo-score-badge seo-score-${seoScoreCls}" title="SEO Score">⚡${s.seo_score}</span>`
    : '';
  const seoThumbHtml = s.thumbnail_offset_sec
    ? `<div class="seo-thumb-hint">🖼️ Melhor frame: +${parseFloat(s.thumbnail_offset_sec).toFixed(1)}s</div>`
    : '';

  const tagsHtml = activeTags && activeTags.length
    ? `<div class="card-tags">${activeTags.map(t => `<span class="tag-pill${hasSEO ? ' seo-tag' : ''}">${esc(t)}</span>`).join('')}</div>`
    : '';
  const descHtml = activeDesc
    ? `<div class="card-desc-preview">${esc(activeDesc)}</div>`
    : '';

  const metaLabel = hasSEO ? '⚡ SEO Squad' : '✦ Metadados sugeridos';
  const suggestedMetaHtml = (tagsHtml || descHtml || hasSEO)
    ? `<div class="card-suggested-meta">
        <div class="card-suggested-meta-label">${metaLabel}${seoBadgeHtml}</div>
        ${s.seo_title && s.seo_title !== s.title ? `<div class="seo-optimized-title">${esc(s.seo_title)}</div>` : ''}
        ${tagsHtml}
        ${descHtml}
        ${seoThumbHtml}
       </div>`
    : '';

  card.innerHTML = `
    <div class="card-thumb-wrap">
      <img
        class="card-thumb"
        src="/api/suggestions/${s.id}/thumbnail"
        alt="Preview"
        loading="lazy"
        onerror="this.parentElement.style.display='none'"
      >
    </div>
    <div class="card-body">
      <div class="card-header">
        <div class="card-title">${esc(s.title)}${categoryBadge}</div>
        <div class="card-meta">
          <span class="badge badge-${s.type}">${s.type === 'video' ? 'VÍDEO' : 'REEL'}</span>
          <span class="timestamps">${fmt(s.start_time)} → ${fmt(s.end_time)} (${dur(s.start_time, s.end_time)})</span>
        </div>
      </div>
      ${s.reason ? `<div class="card-reason">${esc(s.reason)}</div>` : ''}
      ${suggestedMetaHtml}
      ${snippet   ? `<div class="card-transcript">${esc(snippet)}</div>` : ''}
      <div class="card-actions" id="actions-${s.id}">
        ${isDecided
          ? renderDecidedActions(s)
          : `<button class="btn btn-success btn-sm" onclick="decideSuggestion(${s.id},'approved',this)">✓ Aprovar</button>
             <button class="btn btn-danger btn-sm"  onclick="decideSuggestion(${s.id},'rejected',this)">✗ Rejeitar</button>`
        }
        <button class="btn btn-seo btn-sm" id="seo-btn-${s.id}" onclick="runSEO(${s.id}, this)"
          title="Executar SEO Squad — otimiza título, tags, descrição e thumbnail"
        >${hasSEO ? '⚡ Re-SEO' : '⚡ SEO'}</button>
      </div>
    </div>
  `;
  return card;
}

function renderDecidedActions(s) {
  if (s.status === 'rejected') return '<span class="clip-status">Rejeitado</span>';
  return `<span class="clip-status" id="clip-status-${s.id}">Aguardando corte...</span>`;
}

// ── Aprovar / Rejeitar ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
async function decideSuggestion(id, status, btn) {
  btn.disabled = true;
  const other = btn.parentElement.querySelector(status === 'approved' ? '.btn-danger' : '.btn-success');
  if (other) other.disabled = true;

  try {
    const result = await api('PATCH', `/api/suggestions/${id}`, { status });
    if (!result) return;

    if (result.error) {
      showToast(result.error, 'error');
      btn.disabled = false;
      if (other) other.disabled = false;
      return;
    }

    const card = document.getElementById(`suggestion-${id}`);
    card.className = `suggestion-card ${status}`;

    const actions = document.getElementById(`actions-${id}`);
    actions.innerHTML = renderDecidedActions({ id, status });

    if (status === 'approved') {
      pollClipStatus(id, null);
    }
  } catch (err) {
    showToast('Erro ao processar decisão. Tente novamente.', 'error');
    btn.disabled = false;
    if (other) other.disabled = false;
  }
}

// ── Poll clip ──────────────────────────────────────────────────────────────

async function pollClipStatus(suggestionId, clipId) {
  const statusEl = document.getElementById(`clip-status-${suggestionId}`);
  if (!statusEl) return;

  statusEl.textContent = '⏳ Aguardando corte...';

  let attempts = 0;
  const poll = async () => {
    attempts++;
    const actionsEl = document.getElementById(`actions-${suggestionId}`);
    if (!actionsEl) { clearInterval(poller); return; }

    // Busca clip via suggestions endpoint (retorna clip_id e clip_status)
    const data = await api('GET', `/api/jobs/${currentJobId}/suggestions`);
    if (!data) { clearInterval(poller); return; }

    const sug = data.suggestions.find(s => s.id === suggestionId);
    if (!sug) { clearInterval(poller); return; }

    const cId = clipId || sug.clip_id;
    const cStatus = sug.clip_status;

    if (!cId || !cStatus) {
      if (attempts > 40) { clearInterval(poller); statusEl.textContent = '❌ Timeout'; }
      return;
    }

    if (cStatus === 'cutting') {
      statusEl.textContent = '✂️ Cortando...';
      return;
    }

    clearInterval(poller);

    if (cStatus === 'ready') {
      statusEl.className = 'clip-status ready';
      statusEl.textContent = '✓ Pronto!';
      buildUploadForm({ id: cId }, suggestionId).then(form => actionsEl.appendChild(form));
      return;
    }

    if (cStatus === 'failed') {
      statusEl.textContent = '❌ Falha no corte';
    }
  };

  const poller = setInterval(poll, 5000);
  poll();
}

// ── Upload Form ────────────────────────────────────────────────────────────

async function buildUploadForm(clip, suggestionId) {
  const card = document.getElementById(`suggestion-${suggestionId}`);
  const defaultTitle = card ? (card.dataset.suggestionTitle || '') : '';

  const form = document.createElement('div');
  form.className = 'upload-form';
  form.id = `upload-form-${suggestionId}`;
  form.innerHTML = `
    <button class="btn btn-ghost btn-sm preview-btn" onclick="openPreview(${clip.id})">▶ Pré-visualizar</button>
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
      <textarea id="upload-desc-${suggestionId}" rows="3" placeholder="Descrição do vídeo..."></textarea>
    </div>
    <div class="form-group" style="margin-top:10px">
      <label>Tags <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0">(separadas por vírgula, máx 15)</span></label>
      <input type="text" id="upload-tags-${suggestionId}" placeholder="tag1, tag2, tag3..." maxlength="500">
    </div>
    <button class="btn btn-primary btn-sm" style="margin-top:8px"
      onclick="scheduleUpload(${clip.id}, ${suggestionId})">Agendar Upload</button>
    <span class="clip-status" id="upload-status-${suggestionId}"></span>
  `;

  // Pré-preenche título, descrição e tags com metadados gerados pela IA
  const meta = await api('GET', `/api/suggestions/${suggestionId}/metadata`);
  if (meta) {
    const titleInput = document.getElementById(`upload-title-${suggestionId}`);
    const descInput  = document.getElementById(`upload-desc-${suggestionId}`);
    const tagsInput  = document.getElementById(`upload-tags-${suggestionId}`);
    if (titleInput && meta.title) titleInput.value = meta.title.substring(0, 100);
    if (descInput  && meta.description) descInput.value = meta.description;
    if (tagsInput  && Array.isArray(meta.tags) && meta.tags.length) {
      tagsInput.value = meta.tags.join(', ');
    }
  }

  return form;
}

// ── Preview Modal ──────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function openPreview(clipId) {
  const modal = document.getElementById('preview-modal');
  const video = document.getElementById('preview-video');
  video.src = `/api/clips/${clipId}/stream`;
  modal.classList.add('open');
  video.play().catch(() => {});
}

// eslint-disable-next-line no-unused-vars
function closePreview(e) {
  if (e && e.target !== document.getElementById('preview-modal') && !e.target.classList.contains('preview-close')) return;
  const modal = document.getElementById('preview-modal');
  const video = document.getElementById('preview-video');
  video.pause();
  video.src = '';
  modal.classList.remove('open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePreview({ target: document.getElementById('preview-modal') });
});

// eslint-disable-next-line no-unused-vars
async function scheduleUpload(clipId, suggestionId) {
  const title    = document.getElementById(`upload-title-${suggestionId}`).value.trim();
  const desc     = document.getElementById(`upload-desc-${suggestionId}`).value.trim();
  const date     = document.getElementById(`upload-date-${suggestionId}`).value;
  const tagsRaw  = document.getElementById(`upload-tags-${suggestionId}`).value.trim();
  const statusEl = document.getElementById(`upload-status-${suggestionId}`);

  if (!title) { statusEl.textContent = 'Título obrigatório'; return; }

  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : null;

  statusEl.textContent = 'Agendando...';

  const result = await api('POST', '/api/uploads', {
    clip_id: clipId,
    title,
    description: desc,
    tags,
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

// ── Upload de arquivo em chunks ─────────────────────────────────────────────

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB por chunk

async function uploadFileInChunks(file, progressEl) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = `upload_${Date.now()}`;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    const summonerInput = document.getElementById('summoner-name-input');
    const regionSelect  = document.getElementById('riot-region-select');
    formData.append('chunk', chunk);
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', i);
    formData.append('totalChunks', totalChunks);
    formData.append('fileName', file.name);
    formData.append('content_type', selectedContentType);
    if (summonerInput && summonerInput.value.trim()) {
      formData.append('summoner_name', summonerInput.value.trim());
      formData.append('riot_region', regionSelect ? regionSelect.value : 'BR1');
    }

    const pct = Math.round(((i + 1) / totalChunks) * 100);
    progressEl.textContent = `Enviando... ${pct}% (parte ${i + 1}/${totalChunks})`;

    const res = await fetch('/api/jobs/upload-chunk', { method: 'POST', body: formData });
    if (res.status === 401) { location.href = '/login.html'; return null; }

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Último chunk — retorna o job criado
    if (data.job) return data.job;
  }
  return null;
}

// ── Upload zone drag-and-drop ──────────────────────────────────────────────
const uploadZone = document.getElementById('upload-zone');
const fileInput  = document.getElementById('file-input');
const uploadBtn  = document.getElementById('upload-btn');

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    const f = fileInput.files[0];
    uploadZone.querySelector('.upload-zone-label').textContent = f.name;
    uploadZone.querySelector('.upload-zone-hint').textContent = `${(f.size/1024/1024).toFixed(1)} MB`;
    uploadZone.querySelector('.upload-zone-icon').textContent = '🎬';
    uploadBtn.style.display = 'flex';
  }
});

uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const progressEl = document.getElementById('upload-progress');
  const btn = document.getElementById('upload-btn');

  if (!fileInput.files.length) return;

  const file = fileInput.files[0];
  btn.disabled = true;
  progressEl.style.display = 'block';
  progressEl.textContent = `⏳ Iniciando envio de ${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)...`;

  stopPolling();
  transcriptionWords = [];
  document.getElementById('suggestions-section').style.display = 'none';
  document.getElementById('suggestions-list').innerHTML = '';

  try {
    const job = await uploadFileInChunks(file, progressEl);

    if (!job || job.error || !job.id) {
      progressEl.textContent = job?.error || 'Erro ao enviar arquivo';
      btn.disabled = false;
      return;
    }

    progressEl.textContent = `✅ Arquivo recebido! Iniciando transcrição...`;
    currentJobId = job.id;
    updateProgress('downloaded');
    startPolling(job.id);
  } catch (err) {
    progressEl.textContent = `Erro: ${err.message}`;
  } finally {
    btn.disabled = false;
    fileInput.value = '';
    uploadZone.querySelector('.upload-zone-label').textContent = 'Clique ou arraste o vídeo aqui';
    uploadZone.querySelector('.upload-zone-hint').textContent = 'MP4, MKV, AVI, MOV, WEBM';
    uploadZone.querySelector('.upload-zone-icon').textContent = '📁';
    uploadBtn.style.display = 'none';
  }
});

// ── Form submit ────────────────────────────────────────────────────────────

// ── Jobs recentes ──────────────────────────────────────────────────────────

const STATUS_BADGE = {
  pending:      { label: 'Pendente',      bg: 'rgba(120,120,120,0.15)', color: '#888' },
  downloading:  { label: 'Baixando',      bg: 'rgba(201,162,39,0.12)',  color: '#c9a227' },
  downloaded:   { label: 'Baixado',       bg: 'rgba(201,162,39,0.12)',  color: '#c9a227' },
  transcribing: { label: 'Transcrevendo', bg: 'rgba(201,162,39,0.12)',  color: '#c9a227' },
  transcribed:  { label: 'Transcrito',    bg: 'rgba(201,162,39,0.12)',  color: '#c9a227' },
  analyzing:    { label: 'Analisando',    bg: 'rgba(201,162,39,0.12)',  color: '#c9a227' },
  analyzed:     { label: '✓ Pronto',      bg: 'rgba(34,197,94,0.12)',   color: '#4ade80' },
  failed:       { label: '✗ Falhou',      bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
};

async function loadRecentJobs() {
  const jobs = await api('GET', '/api/jobs');
  if (!jobs || !jobs.length) return;

  const list = document.getElementById('jobs-list');
  list.innerHTML = '';

  jobs.slice(0, 10).forEach(job => {
    const badge = STATUS_BADGE[job.status] || { label: job.status, bg: 'rgba(120,120,120,0.15)', color: '#888' };
    const row = document.createElement('div');
    row.className = 'job-row';
    const ctIcons = { 'batalha-de-rima': '🎤', toguro: '🎮', mbl: '🏛️', comedia: '😂', 'lol-esports': '⚔️', sinuca: '🎱', 'slap-battles': '🤜' };
    const ctIcon = ctIcons[job.content_type] || '🎬';
    row.innerHTML = `
      <span class="job-status-badge" style="background:${badge.bg};color:${badge.color};border:1px solid ${badge.color}33">${badge.label}</span>
      <span style="font-size:14px">${ctIcon}</span>
      <span class="job-title">${esc(job.title || job.url)}</span>
      <span class="job-id">#${job.id}</span>
    `;
    if (job.status === 'analyzed') {
      row.addEventListener('click', () => {
        currentJobId = job.id;
        currentJob = job;
        document.getElementById('suggestions-section').style.display = 'none';
        loadSuggestions(job.id);
        updateProgress(job.status);
        window.scrollTo(0, 0);
      });
    } else if (['downloading','transcribing','analyzing','transcribed','downloaded','pending'].includes(job.status)) {
      row.addEventListener('click', () => {
        currentJobId = job.id;
        updateProgress(job.status);
        startPolling(job.id);
        window.scrollTo(0, 0);
      });
    } else {
      row.style.cursor = 'default';
      row.title = job.error_message || '';
    }
    list.appendChild(row);
  });
}

// ── Uploads com falha ─────────────────────────────────────────────────────

async function loadFailedUploads() {
  const data = await api('GET', '/api/uploads?status=failed');
  if (!data || !data.length) return;

  const section = document.getElementById('failed-uploads-section');
  const list    = document.getElementById('failed-uploads-list');
  section.style.display = 'block';
  list.innerHTML = '';

  data.forEach(u => {
    const row = document.createElement('div');
    row.className = 'failed-upload-row';
    row.id = `failed-upload-${u.id}`;
    row.innerHTML =
      `<span class="failed-upload-title" title="${esc(u.title || '')}">${esc((u.title || 'Sem título').substring(0, 55))}</span>` +
      `<span class="failed-upload-reason">${esc((u.failure_reason || '').substring(0, 80))}</span>` +
      `<button class="btn btn-ghost btn-sm" onclick="retryUpload(${u.id}, this)">↺ Tentar novamente</button>`;
    list.appendChild(row);
  });
}

// eslint-disable-next-line no-unused-vars
async function retryUpload(uploadId, btn) {
  btn.disabled = true;
  btn.textContent = 'Reenviando...';
  const result = await api('POST', `/api/uploads/${uploadId}/retry`);
  if (result && !result.error) {
    showToast('Upload re-enfileirado!', 'success');
    document.getElementById(`failed-upload-${uploadId}`)?.remove();
    const remaining = document.querySelectorAll('[id^="failed-upload-"]');
    if (!remaining.length) document.getElementById('failed-uploads-section').style.display = 'none';
  } else {
    showToast(result?.error || 'Erro ao re-enfileirar', 'error');
    btn.disabled = false;
    btn.textContent = '↺ Tentar novamente';
  }
}

// Carrega jobs ao abrir a página
loadRecentJobs();
loadFailedUploads();

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

  const summonerInput = document.getElementById('summoner-name-input');
  const regionSelect  = document.getElementById('riot-region-select');
  const job = await api('POST', '/api/jobs', {
    url,
    content_type: selectedContentType,
    summoner_name: summonerInput ? (summonerInput.value.trim() || null) : null,
    riot_region:   regionSelect  ? (regionSelect.value || 'BR1')        : 'BR1',
  });
  if (!job || job.error) {
    document.getElementById('status-text').textContent = job?.error || 'Erro ao criar job';
    btn.disabled = false;
    return;
  }

  currentJobId = job.id;
  startPolling(job.id);
  btn.disabled = false;
});

// ── SEO Squad ─────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
async function runSEO(suggestionId, btn) {
  btn.disabled = true;
  btn.textContent = '⏳ Analisando...';

  const result = await api('POST', `/api/suggestions/${suggestionId}/seo`);

  if (!result || result.error) {
    btn.disabled = false;
    btn.textContent = '⚡ SEO';
    showToast(result?.error || 'Erro ao executar SEO Squad', 'error');
    return;
  }

  const card = document.getElementById(`suggestion-${suggestionId}`);

  // Remove SEO info anterior e recria com dados atualizados
  card.querySelectorAll('.card-suggested-meta').forEach(el => el.remove());

  const seoScoreCls = result.seoScore >= 70 ? 'high' : result.seoScore >= 50 ? 'mid' : 'low';
  const tagsHtml = (result.seoTags || [])
    .map(t => `<span class="tag-pill seo-tag">${esc(t)}</span>`).join('');
  const thumbHtml = result.thumbnailOffsetSec
    ? `<div class="seo-thumb-hint">🖼️ Melhor frame: +${result.thumbnailOffsetSec.toFixed(1)}s — ${esc(result.thumbnailRationale || '')}</div>`
    : '';

  const seoBlock = document.createElement('div');
  seoBlock.className = 'card-suggested-meta';
  seoBlock.innerHTML = `
    <div class="card-suggested-meta-label">⚡ SEO Squad
      <span class="seo-score-badge seo-score-${seoScoreCls}" title="SEO Score">⚡${result.seoScore}</span>
    </div>
    ${result.seoTitle ? `<div class="seo-optimized-title">${esc(result.seoTitle)}</div>` : ''}
    <div class="card-tags">${tagsHtml}</div>
    ${result.seoDescription ? `<div class="card-desc-preview">${esc(result.seoDescription)}</div>` : ''}
    ${thumbHtml}
    ${result.strategy ? `<div class="seo-strategy-hint">${esc(result.strategy)}</div>` : ''}
  `;

  const cardActions = card.querySelector('.card-actions');
  cardActions.parentElement.insertBefore(seoBlock, cardActions);

  // Atualiza thumbnail com o frame recomendado
  const thumbImg = card.querySelector('.card-thumb');
  if (thumbImg && result.thumbnailOffsetSec) {
    thumbImg.src = `/api/suggestions/${suggestionId}/thumbnail?t=${Date.now()}`;
  }

  btn.textContent = '⚡ Re-SEO';
  btn.disabled = false;
  showToast(`SEO Score: ${result.seoScore}/100 — ${result.strategy || 'Otimização concluída'}`, 'success');
}

// ── Painel de Custos ──────────────────────────────────────────────────────
let costsLoaded = false;

function toggleCosts() {
  const body    = document.getElementById('costs-body');
  const chevron = document.getElementById('costs-chevron');
  const open    = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  chevron.textContent = open ? '▲' : '▼';
  if (open && !costsLoaded) loadCosts();
}

async function loadCosts() {
  const el = document.getElementById('costs-content');
  try {
    const d = await api('GET', '/api/costs');
    costsLoaded = true;

    const badge = document.getElementById('costs-total-badge');
    badge.textContent = `$${d.combined.month.toFixed(4)} este mês`;

    const fmtUsd = v => `$${parseFloat(v).toFixed(4)}`;
    const bar = (label, val, total) => {
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      return `<div class="cost-bar-wrap">
        <span class="cost-bar-label">${label}</span>
        <div class="cost-bar-track"><div class="cost-bar-fill" style="width:${pct}%"></div></div>
        <span class="cost-bar-value">${fmtUsd(val)}</span>
      </div>`;
    };

    const periods = [
      ['Hoje',       d.combined.today, d.assemblyai.today, d.openai.today],
      ['7 dias',     d.combined.week,  d.assemblyai.week,  d.openai.week],
      ['30 dias',    d.combined.month, d.assemblyai.month, d.openai.month],
      ['Total',      d.combined.total, d.assemblyai.total, d.openai.total],
    ];

    const rows = periods.map(([label, total, ai, gpt]) =>
      `<tr>
        <td class="cost-td-label">${label}</td>
        <td class="cost-td">${fmtUsd(ai)}</td>
        <td class="cost-td">${fmtUsd(gpt)}</td>
        <td class="cost-td cost-td-total">${fmtUsd(total)}</td>
      </tr>`
    ).join('');

    const topRows = (d.top_jobs || []).map(j =>
      `<tr>
        <td class="cost-td-label" title="${esc(j.title || '')}">${esc((j.title || 'sem título').substring(0, 40))}</td>
        <td class="cost-td">${fmtUsd(j.assemblyai)}</td>
        <td class="cost-td">${fmtUsd(j.openai)}</td>
        <td class="cost-td cost-td-total">${fmtUsd(j.total)}</td>
      </tr>`
    ).join('');

    el.innerHTML = `
      <table class="cost-table">
        <thead><tr>
          <th></th><th>AssemblyAI</th><th>OpenAI GPT</th><th>Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${topRows ? `
        <div class="cost-section-title">Top jobs por custo</div>
        <table class="cost-table">
          <thead><tr>
            <th>Job</th><th>AssemblyAI</th><th>OpenAI GPT</th><th>Total</th>
          </tr></thead>
          <tbody>${topRows}</tbody>
        </table>` : ''}
    `;
  } catch {
    el.textContent = 'Erro ao carregar custos.';
  }
}
