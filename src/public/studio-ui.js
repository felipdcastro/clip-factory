// ── Studio — Upload próprio com Efeitos + Legenda ─────────────────────────

// eslint-disable-next-line no-unused-vars
function toggleStudioSection() {
  const body    = document.getElementById('studio-body');
  const chevron = document.getElementById('studio-chevron');
  const open    = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  chevron.textContent = open ? '▲' : '▼';
}

(function initStudio() {
  const zone     = document.getElementById('studio-upload-zone');
  const fileInput= document.getElementById('studio-file-input');
  const nameEl   = document.getElementById('studio-file-name');
  if (!zone || !fileInput) return;

  zone.addEventListener('click', () => fileInput.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) setStudioFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setStudioFile(fileInput.files[0]);
  });
})();

function setStudioFile(file) {
  const nameEl = document.getElementById('studio-file-name');
  const btn    = document.getElementById('studio-process-btn');
  if (nameEl) nameEl.textContent = file.name;
  if (btn) btn.style.display = 'block';
  window._studioFile = file;
}

function getStudioEffects() {
  const effects = {};
  const checks = [
    ['studio-effect-mirror',    'mirror'],
    ['studio-effect-zoom',      'zoom'],
    ['studio-effect-speed',     'speed'],
    ['studio-effect-subtitles', 'subtitles'],
  ];
  checks.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && el.checked) effects[key] = true;
  });
  const colorFilter = document.querySelector('input[name="studio-color-filter"]:checked');
  if (colorFilter && colorFilter.value) effects.filter = colorFilter.value;
  return effects;
}

// eslint-disable-next-line no-unused-vars
async function submitStudio() {
  const file = window._studioFile;
  if (!file) { showToast('Selecione um vídeo primeiro', 'error'); return; }

  const effects = getStudioEffects();
  if (!Object.keys(effects).length) { showToast('Selecione pelo menos um efeito', 'error'); return; }

  const btn      = document.getElementById('studio-process-btn');
  const statusEl = document.getElementById('studio-status-msg');
  btn.disabled   = true;
  statusEl.textContent = 'Enviando vídeo...';

  try {
    const type = file.name.match(/\.(mp4|mov|avi|mkv|webm)$/i) ? 'video' : 'video';
    const formData = new FormData();
    formData.append('video', file);
    formData.append('effects', JSON.stringify(effects));
    formData.append('type', type);

    const uploadRes = await fetch('/api/studio/upload', {
      method: 'POST',
      body: formData,
    });

    if (uploadRes.status === 401) { location.href = '/login.html'; return; }

    const data = await uploadRes.json();
    if (data.error) {
      showToast(data.error, 'error');
      btn.disabled = false;
      statusEl.textContent = '';
      return;
    }

    const hasSubtitles = effects.subtitles;
    showToast(hasSubtitles ? 'Processando — transcrevendo e aplicando efeitos...' : 'Processando efeitos...', 'info');
    statusEl.textContent = hasSubtitles ? 'Transcrevendo legenda...' : 'Processando...';

    pollStudioStatus(data.remix_id, btn, statusEl, hasSubtitles);
  } catch (e) {
    showToast('Erro ao enviar vídeo', 'error');
    btn.disabled = false;
    statusEl.textContent = '';
  }
}

function pollStudioStatus(remixId, btn, statusEl, hasSubtitles) {
  let attempts = 0;
  const MAX = 180; // 15 minutos (legendas levam mais tempo)

  const poller = setInterval(async function() {
    attempts++;
    const remix = await api('GET', '/api/remixes/' + remixId);
    if (!remix) { clearInterval(poller); return; }

    if (remix.status === 'processing') {
      statusEl.textContent = hasSubtitles ? 'Transcrevendo e aplicando efeitos...' : 'Aplicando efeitos...';
      return;
    }
    if (remix.status === 'failed') {
      clearInterval(poller);
      statusEl.textContent = 'Falhou';
      btn.disabled = false;
      showToast('Processamento falhou. Tente novamente.', 'error');
      return;
    }
    if (remix.status === 'ready') {
      clearInterval(poller);
      statusEl.textContent = 'Pronto!';
      btn.disabled = false;
      showStudioResult(remix);
      return;
    }
    if (attempts >= MAX) {
      clearInterval(poller);
      statusEl.textContent = 'Timeout';
      btn.disabled = false;
    }
  }, 5000);
}

function showStudioResult(remix) {
  const container = document.getElementById('studio-results');
  if (!container) return;
  if (document.getElementById('studio-result-' + remix.id)) return;

  const resultEl = document.createElement('div');
  resultEl.id = 'studio-result-' + remix.id;
  resultEl.style.cssText = 'margin-top:16px;padding:14px;border-radius:var(--radius);border:1px solid rgba(139,92,246,0.3);background:rgba(139,92,246,0.06)';
  resultEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
      '<span style="color:#c4b5fd;font-weight:600">Vídeo processado</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="openRemixPreview(' + remix.id + ')">&#9654; Pré-visualizar</button>' +
    '</div>' +
    '<div style="font-size:.85rem;font-weight:600;margin-bottom:8px">Agendar publicação</div>' +
    '<div class="upload-row">' +
      '<div class="form-group">' +
        '<label>Título</label>' +
        '<input type="text" id="studio-upload-title-' + remix.id + '" maxlength="100" placeholder="Título no YouTube">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Agendar para</label>' +
        '<input type="datetime-local" id="studio-upload-date-' + remix.id + '">' +
      '</div>' +
    '</div>' +
    '<div class="form-group" style="margin-top:8px">' +
      '<label>Descrição</label>' +
      '<textarea id="studio-upload-desc-' + remix.id + '" rows="2" placeholder="Descrição..."></textarea>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:8px" ' +
      'onclick="scheduleStudioUpload(' + remix.result_clip_id + ',' + remix.id + ')">Agendar Upload</button>' +
    '<span class="clip-status" id="studio-upload-status-' + remix.id + '"></span>';

  container.appendChild(resultEl);
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// eslint-disable-next-line no-unused-vars
async function scheduleStudioUpload(resultClipId, remixId) {
  const titleEl  = document.getElementById('studio-upload-title-' + remixId);
  const dateEl   = document.getElementById('studio-upload-date-' + remixId);
  const descEl   = document.getElementById('studio-upload-desc-' + remixId);
  const statusEl = document.getElementById('studio-upload-status-' + remixId);

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
