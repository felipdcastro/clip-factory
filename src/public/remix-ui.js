/* global api, esc, showToast */

// ── Remix / Efeitos de Câmera ──────────────────────────────────────────────

let remixSelectedClipId = null;

// eslint-disable-next-line no-unused-vars
function toggleRemixSection() {
  const body    = document.getElementById('remix-body');
  const chevron = document.getElementById('remix-chevron');
  const open    = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  chevron.textContent = open ? '▲' : '▼';
  if (open) loadRemixableClips();
}

function initRemixToggleHighlights() {
  document.querySelectorAll('.remix-effect-toggle input').forEach(input => {
    function sync() {
      const label = input.closest('.remix-effect-toggle');
      if (input.type === 'checkbox') {
        label.classList.toggle('active', input.checked);
      } else {
        document.querySelectorAll('.remix-effect-toggle input[type=radio]').forEach(r => {
          r.closest('.remix-effect-toggle').classList.remove('active');
        });
        if (input.value) label.classList.add('active');
      }
    }
    input.addEventListener('change', sync);
    sync();
  });
}
initRemixToggleHighlights();

function getSelectedEffects() {
  const effects = {};
  if (document.getElementById('effect-mirror') && document.getElementById('effect-mirror').checked) effects.mirror = true;
  if (document.getElementById('effect-zoom')   && document.getElementById('effect-zoom').checked)   effects.zoom   = true;
  if (document.getElementById('effect-speed')  && document.getElementById('effect-speed').checked)  effects.speed  = true;
  const colorFilter = document.querySelector('input[name="color-filter"]:checked');
  if (colorFilter && colorFilter.value) effects.filter = colorFilter.value;
  return effects;
}

function fmtMs(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function loadRemixableClips() {
  const list = document.getElementById('remix-clips-list');
  list.innerHTML = '<div style="opacity:.5;font-size:.9rem">Carregando...</div>';
  remixSelectedClipId = null;

  const clips = await api('GET', '/api/remixes/clips');
  if (!clips || clips.error) {
    list.innerHTML = '<div style="opacity:.5">Erro ao carregar clips.</div>';
    return;
  }
  if (!clips.length) {
    list.innerHTML = '<div style="opacity:.5;font-size:.9rem">Nenhum clip pronto encontrado.</div>';
    return;
  }

  list.innerHTML = '';
  clips.forEach(clip => {
    const title = clip.seo_title || clip.title || ('Clip #' + clip.id);
    const row = document.createElement('div');
    row.className = 'remix-clip-row';
    row.id = 'remix-clip-' + clip.id;
    row.innerHTML =
      '<span class="remix-clip-type">' + (clip.type === 'reel' ? 'REEL' : 'VÍDEO') + '</span>' +
      '<span class="remix-clip-title" title="' + esc(title) + '">' + esc(title) + '</span>' +
      '<span class="remix-clip-meta">' + fmtMs(clip.duration_ms) + '</span>';
    row.addEventListener('click', function() { selectRemixClip(clip.id); });
    list.appendChild(row);
  });

  const existing = document.getElementById('remix-action-area');
  if (existing) existing.remove();

  const actionArea = document.createElement('div');
  actionArea.id = 'remix-action-area';
  actionArea.className = 'remix-actions';
  actionArea.style.display = 'none';
  actionArea.innerHTML =
    '<button class="btn btn-primary btn-sm" onclick="submitRemix()">🎨 Aplicar Efeitos</button>' +
    '<span class="remix-status" id="remix-status-msg"></span>';
  list.parentElement.appendChild(actionArea);
}

function selectRemixClip(clipId) {
  remixSelectedClipId = clipId;
  document.querySelectorAll('.remix-clip-row').forEach(function(r) { r.classList.remove('selected'); });
  const row = document.getElementById('remix-clip-' + clipId);
  if (row) row.classList.add('selected');
  const actionArea = document.getElementById('remix-action-area');
  if (actionArea) actionArea.style.display = 'flex';
}

// eslint-disable-next-line no-unused-vars
async function submitRemix() {
  if (!remixSelectedClipId) { showToast('Selecione um clip primeiro', 'error'); return; }

  const effects = getSelectedEffects();
  if (!Object.keys(effects).length) { showToast('Selecione pelo menos um efeito', 'error'); return; }

  const btn = document.querySelector('#remix-action-area .btn-primary');
  const statusEl = document.getElementById('remix-status-msg');
  btn.disabled = true;
  statusEl.textContent = 'Enviando...';

  try {
    const remix = await api('POST', '/api/remixes', { clip_id: remixSelectedClipId, effects: effects });
    if (!remix || remix.error) {
      showToast(remix && remix.error ? remix.error : 'Erro ao criar remix', 'error');
      btn.disabled = false;
      statusEl.textContent = '';
      return;
    }

    showToast('Remix enfileirado! Processando...', 'info');
    statusEl.textContent = 'Processando...';
    pollRemixStatus(remix.id, btn, statusEl);
  } catch {
    showToast('Erro ao criar remix', 'error');
    btn.disabled = false;
    statusEl.textContent = '';
  }
}

function pollRemixStatus(remixId, btn, statusEl) {
  let attempts = 0;
  const MAX = 120;

  const poller = setInterval(async function() {
    attempts++;
    const remix = await api('GET', '/api/remixes/' + remixId);
    if (!remix) { clearInterval(poller); return; }

    if (remix.status === 'processing') {
      statusEl.textContent = 'Aplicando efeitos...';
      return;
    }
    if (remix.status === 'failed') {
      clearInterval(poller);
      statusEl.textContent = 'Falhou';
      btn.disabled = false;
      showToast('Remix falhou. Tente novamente.', 'error');
      return;
    }
    if (remix.status === 'ready') {
      clearInterval(poller);
      statusEl.textContent = 'Pronto!';
      btn.disabled = false;
      showRemixResult(remix);
      return;
    }
    if (attempts >= MAX) {
      clearInterval(poller);
      statusEl.textContent = 'Timeout';
      btn.disabled = false;
    }
  }, 5000);
}

function showRemixResult(remix) {
  const actionArea = document.getElementById('remix-action-area');
  if (!actionArea) return;
  if (document.getElementById('remix-result-' + remix.id)) return;

  const resultEl = document.createElement('div');
  resultEl.id = 'remix-result-' + remix.id;
  resultEl.style.cssText = 'margin-top:16px;padding:14px;border-radius:var(--radius);border:1px solid rgba(139,92,246,0.3);background:rgba(139,92,246,0.06);width:100%';
  resultEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
      '<span style="color:#c4b5fd;font-weight:600">Remix pronto</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="openRemixPreview(' + remix.id + ')">Pré-visualizar</button>' +
    '</div>' +
    '<div style="font-size:.85rem;font-weight:600;margin-bottom:8px">Agendar publicação</div>' +
    '<div class="upload-row">' +
      '<div class="form-group">' +
        '<label>Título</label>' +
        '<input type="text" id="remix-upload-title-' + remix.id + '" maxlength="100" placeholder="Título no YouTube">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Agendar para</label>' +
        '<input type="datetime-local" id="remix-upload-date-' + remix.id + '">' +
      '</div>' +
    '</div>' +
    '<div class="form-group" style="margin-top:8px">' +
      '<label>Descrição</label>' +
      '<textarea id="remix-upload-desc-' + remix.id + '" rows="2" placeholder="Descrição..."></textarea>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:8px" ' +
      'onclick="scheduleRemixUpload(' + remix.result_clip_id + ',' + remix.id + ')">Agendar Upload</button>' +
    '<span class="clip-status" id="remix-upload-status-' + remix.id + '"></span>';

  actionArea.parentElement.appendChild(resultEl);
}

// eslint-disable-next-line no-unused-vars
function openRemixPreview(remixId) {
  const video = document.getElementById('preview-video');
  const modal = document.getElementById('preview-modal');
  video.src = '/api/remixes/' + remixId + '/stream';
  modal.style.display = 'flex';
  video.play().catch(function() {});
}

// eslint-disable-next-line no-unused-vars
async function scheduleRemixUpload(resultClipId, remixId) {
  const titleEl  = document.getElementById('remix-upload-title-' + remixId);
  const dateEl   = document.getElementById('remix-upload-date-' + remixId);
  const descEl   = document.getElementById('remix-upload-desc-' + remixId);
  const statusEl = document.getElementById('remix-upload-status-' + remixId);

  const title = titleEl ? titleEl.value.trim() : '';
  const date  = dateEl  ? dateEl.value         : '';
  const desc  = descEl  ? descEl.value.trim()  : '';

  if (!title) { showToast('Título é obrigatório', 'error'); return; }

  statusEl.textContent = 'Agendando...';

  const result = await api('POST', '/api/uploads', {
    clip_id:      resultClipId,
    title:        title,
    description:  desc || null,
    scheduled_at: date ? new Date(date).toISOString() : null,
  });

  if (result && !result.error) {
    statusEl.textContent = date ? 'Agendado!' : 'Na fila!';
    showToast('Upload agendado com sucesso!', 'success');
  } else {
    statusEl.textContent = result && result.error ? result.error : 'Erro ao agendar';
    showToast((result && result.error) ? result.error : 'Erro ao agendar', 'error');
  }
}
