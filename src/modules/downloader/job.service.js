const { query } = require('../../db/connection');
const { isValidYouTubeUrl, getVideoMetadata, downloadVideo, MAX_DURATION_SECONDS } = require('./yt-dlp');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger').child({ module: 'downloader' });

const TEMP_DIR = process.env.TEMP_DIR || './tmp';

/**
 * Cria um novo job de download e inicia o processamento em background
 */
const VALID_CONTENT_TYPES = ['mbl', 'batalha-de-rima', 'toguro', 'lol-esports', 'comedia', 'sinuca', 'slap-battles'];

const CONTENT_TYPE_PATTERNS = [
  {
    type: 'lol-esports',
    re: /league of legends|lol esports?|lck|lec|lcs|cblol|worlds|msi\b|faker|t1\b|g2 esports|cloud9|team liquid|fnatic|100 thieves|pentakill/i,
  },
  {
    type: 'batalha-de-rima',
    re: /batalha de rima|batalha\b|freestyle|duelo no mic|liga das batalhas|bde\b|rima\b.*mc\b|mc\b.*rima\b/i,
  },
  {
    type: 'toguro',
    re: /\btoguro\b/i,
  },
  {
    type: 'mbl',
    re: /\bmbl\b|movimento brasil livre|kim kataguiri|arthur do val|deputado|senado|congresso|bolsonaro|lula\b|política brasileira/i,
  },
  {
    type: 'comedia',
    re: /stand.?up|comédia|humor|comediante|piada|esquete|especial de humor/i,
  },
  {
    type: 'sinuca',
    re: /sinuca|bilhar|snooker|baianhinho|tacada|mesa de sinuca|bola de banda|carambola/i,
  },
  {
    type: 'slap-battles',
    re: /slap battle|batalha de tapa|power slap|slap competition|tapa brutal|nocaute de tapa|\bslap\b.*\bknockou?t\b/i,
  },
];

/**
 * Detecta content_type a partir do título e canal do vídeo via keyword matching.
 * Retorna o tipo detectado ou 'mbl' como fallback.
 */
function detectContentType(title = '', channelName = '') {
  const haystack = `${title} ${channelName}`;
  for (const { type, re } of CONTENT_TYPE_PATTERNS) {
    if (re.test(haystack)) return type;
  }
  return null; // sem match — usuário deve selecionar manualmente
}

async function createJob(url, contentType = 'mbl', summonerName = null, riotRegion = 'BR1') {
  if (!isValidYouTubeUrl(url)) {
    throw Object.assign(new Error('URL inválida. Informe uma URL do YouTube válida.'), { status: 400 });
  }
  const autoDetect = contentType === 'auto';
  const ct = autoDetect ? 'mbl' : (VALID_CONTENT_TYPES.includes(contentType) ? contentType : 'mbl');

  // Cria o job no banco com status pending
  const result = await query(
    'INSERT INTO jobs (url, status, content_type, summoner_name, riot_region) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [url, 'pending', ct, summonerName || null, riotRegion || 'BR1']
  );
  const job = result.rows[0];

  // Garante que o diretório tmp existe
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Inicia processamento assíncrono (não aguarda)
  processJob(job.id, url, autoDetect).catch(err => {
    logger.error({ err, job_id: job.id }, `Job ${job.id} failed`);
  });

  return job;
}

/**
 * Pipeline de processamento do job (async background)
 */
async function processJob(jobId, url, autoDetect = false) {
  try {
    // 1. Busca metadados
    await updateJobStatus(jobId, 'downloading');
    const meta = await getVideoMetadata(url);

    // 2. Valida duração
    if (meta.duration_seconds > MAX_DURATION_SECONDS) {
      throw new Error(`Vídeo muito longo (${Math.round(meta.duration_seconds / 3600)}h). Limite: 3 horas.`);
    }

    // 3. Detecta content_type automaticamente se solicitado
    let detectedType = null;
    if (autoDetect) {
      detectedType = detectContentType(meta.title, meta.channel_name);
      if (detectedType) {
        logger.info({ job_id: jobId, detected: detectedType, title: meta.title }, 'Content type detectado automaticamente');
      } else {
        logger.warn({ job_id: jobId, title: meta.title }, 'Auto-detecção não encontrou match — mantendo padrão (mbl)');
      }
    }

    // 4. Salva metadados (e content_type detectado, se houver)
    await query(
      `UPDATE jobs SET title=$1, duration_seconds=$2, thumbnail_url=$3, channel_name=$4,
       content_type=COALESCE($5, content_type), updated_at=NOW()
       WHERE id=$6`,
      [meta.title, meta.duration_seconds, meta.thumbnail_url, meta.channel_name, detectedType, jobId]
    );

    // 5. Faz o download
    const filePath = await downloadVideo(url, jobId);

    // 6. Atualiza com caminho do arquivo
    await query(
      `UPDATE jobs SET status='downloaded', file_path=$1, updated_at=NOW() WHERE id=$2`,
      [filePath, jobId]
    );

    logger.info({ job_id: jobId, file: path.basename(filePath) }, `Job ${jobId} downloaded`);

    // Publica na fila de transcrição imediatamente
    const { enqueueTranscription } = require('../../queues');
    await enqueueTranscription(jobId);
  } catch (err) {
    await query(
      `UPDATE jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
      [err.message, jobId]
    );
    throw err;
  }
}

async function updateJobStatus(jobId, status) {
  await query(
    'UPDATE jobs SET status=$1, updated_at=NOW() WHERE id=$2',
    [status, jobId]
  );
}

async function getJob(jobId) {
  const result = await query('SELECT * FROM jobs WHERE id=$1', [jobId]);
  return result.rows[0] || null;
}

async function listJobs({ page = 1, limit = 50 } = {}) {
  const safePage  = Math.max(1, parseInt(page)  || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset    = (safePage - 1) * safeLimit;
  const result = await query(
    'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [safeLimit, offset]
  );
  return result.rows;
}

/**
 * Cria job a partir de arquivo enviado pelo usuário (sem download)
 */
async function createJobFromFile(filePath, originalName, contentType = 'mbl', summonerName = null, riotRegion = 'BR1') {
  const title = path.basename(originalName, path.extname(originalName));
  const absolutePath = path.resolve(filePath);
  const ct = VALID_CONTENT_TYPES.includes(contentType) ? contentType : 'mbl';

  const result = await query(
    `INSERT INTO jobs (url, title, status, file_path, content_type, summoner_name, riot_region, updated_at)
     VALUES ($1, $2, 'downloaded', $3, $4, $5, $6, NOW()) RETURNING *`,
    [`file://${originalName}`, title, absolutePath, ct, summonerName || null, riotRegion || 'BR1']
  );

  const job = result.rows[0];
  logger.info({ job_id: job.id, file: originalName }, `Job ${job.id} criado via upload`);

  // Arquivo já disponível — publica direto na fila de transcrição
  const { enqueueTranscription } = require('../../queues');
  await enqueueTranscription(job.id);

  return job;
}

module.exports = { createJob, createJobFromFile, getJob, listJobs, VALID_CONTENT_TYPES };
