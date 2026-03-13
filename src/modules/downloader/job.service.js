const { query } = require('../../db/connection');
const { isValidYouTubeUrl, getVideoMetadata, downloadVideo, MAX_DURATION_SECONDS } = require('./yt-dlp');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = process.env.TEMP_DIR || './tmp';

/**
 * Cria um novo job de download e inicia o processamento em background
 */
async function createJob(url) {
  if (!isValidYouTubeUrl(url)) {
    throw Object.assign(new Error('URL inválida. Informe uma URL do YouTube válida.'), { status: 400 });
  }

  // Cria o job no banco com status pending
  const result = await query(
    'INSERT INTO jobs (url, status) VALUES ($1, $2) RETURNING *',
    [url, 'pending']
  );
  const job = result.rows[0];

  // Garante que o diretório tmp existe
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Inicia processamento assíncrono (não aguarda)
  processJob(job.id, url).catch(err => {
    console.error(`Job ${job.id} failed:`, err.message);
  });

  return job;
}

/**
 * Pipeline de processamento do job (async background)
 */
async function processJob(jobId, url) {
  try {
    // 1. Busca metadados
    await updateJobStatus(jobId, 'downloading');
    const meta = await getVideoMetadata(url);

    // 2. Valida duração
    if (meta.duration_seconds > MAX_DURATION_SECONDS) {
      throw new Error(`Vídeo muito longo (${Math.round(meta.duration_seconds / 3600)}h). Limite: 3 horas.`);
    }

    // 3. Salva metadados
    await query(
      `UPDATE jobs SET title=$1, duration_seconds=$2, thumbnail_url=$3, channel_name=$4, updated_at=NOW()
       WHERE id=$5`,
      [meta.title, meta.duration_seconds, meta.thumbnail_url, meta.channel_name, jobId]
    );

    // 4. Faz o download
    const filePath = await downloadVideo(url, jobId);

    // 5. Atualiza com caminho do arquivo
    await query(
      `UPDATE jobs SET status='downloaded', file_path=$1, updated_at=NOW() WHERE id=$2`,
      [filePath, jobId]
    );

    console.log(`✅ Job ${jobId} downloaded: ${path.basename(filePath)}`);
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

async function listJobs() {
  const result = await query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50');
  return result.rows;
}

/**
 * Cria job a partir de arquivo enviado pelo usuário (sem download)
 */
async function createJobFromFile(filePath, originalName) {
  const title = path.basename(originalName, path.extname(originalName));

  const result = await query(
    `INSERT INTO jobs (url, title, status, file_path, updated_at)
     VALUES ($1, $2, 'downloaded', $3, NOW()) RETURNING *`,
    [`file://${originalName}`, title, filePath]
  );

  const job = result.rows[0];
  console.log(`✅ Job ${job.id} criado via upload: ${originalName}`);
  return job;
}

module.exports = { createJob, createJobFromFile, getJob, listJobs };
