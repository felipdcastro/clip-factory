'use strict';

const pLimit = require('p-limit');
const { query } = require('../../db/connection');
const { uploadToYouTube, cleanupClipFile } = require('./youtube-upload.service');
const { isAuthenticated } = require('./youtube-auth.service');
const { withRetry } = require('../../utils/retry');
const { enqueueUpload, removeUploadJob } = require('../../queues');

// Throttle: máx 1 upload simultâneo (quota YouTube API)
const limit = pLimit(1);

const MAX_UPLOAD_ATTEMPTS = 3;

/**
 * Processa um upload agendado com retry automático (backoff exponencial).
 */
async function processUpload(uploadId) {
  // 1. Busca upload + clip + job (para content_type e tags sugeridas)
  const result = await query(
    `SELECT u.*, c.file_path, c.type as clip_type, j.content_type,
            cs.suggested_tags
     FROM uploads u
     JOIN clips c ON c.id = u.clip_id
     LEFT JOIN jobs j ON j.id = c.job_id
     LEFT JOIN clip_suggestions cs ON cs.id = c.suggestion_id
     WHERE u.id = $1`,
    [uploadId]
  );
  const upload = result.rows[0];

  if (!upload) throw new Error(`Upload ${uploadId} não encontrado`);
  if (upload.status !== 'queued') throw new Error(`Upload ${uploadId} não está na fila`);
  if (!upload.file_path) throw new Error(`Clip ${upload.clip_id} não tem arquivo`);

  // 2. Verifica autenticação YouTube
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('YouTube não autorizado. Acesse /auth/youtube para autenticar.');
  }

  // 3. Atualiza status para uploading
  await query("UPDATE uploads SET status='uploading' WHERE id=$1", [uploadId]);

  try {
    // 4. Upload com retry automático (throttled)
    // Double retry intencional:
    // withRetry (maxAttempts: 3) → retenta falhas de rede dentro do worker (rápido, backoff 1s-4s)
    // BullMQ (attempts: 3 em queues/index.js) → retenta falha total do worker (lento, backoff 2s+)
    // Total máx: 9 tentativas para erros retriáveis (429, 5xx, ECONNRESET, etc.)
    // Tags: prioriza confirmadas pelo usuário, depois sugeridas pela IA
    const finalTags = (Array.isArray(upload.tags) && upload.tags.length)
      ? upload.tags
      : (Array.isArray(upload.suggested_tags) && upload.suggested_tags.length
        ? upload.suggested_tags
        : null);

    const { videoId, videoUrl } = await withRetry(
      () => limit(() =>
        uploadToYouTube(
          upload.file_path,
          upload.title,
          upload.description,
          upload.clip_type,
          upload.scheduled_at,
          finalTags,
          upload.content_type
        )
      ),
      {
        maxAttempts: MAX_UPLOAD_ATTEMPTS,
        baseDelayMs: 1000,
        onRetry: async ({ attempt, error, nextRetryInMs }) => {
          require('../../utils/logger').child({ module: 'uploader' }).warn(
            { upload_id: uploadId, attempt, next_retry_ms: nextRetryInMs, err: error },
            `Upload ${uploadId} falhou (tentativa ${attempt}/${MAX_UPLOAD_ATTEMPTS})`
          );
          await query(
            'UPDATE uploads SET retry_count = retry_count + 1 WHERE id=$1',
            [uploadId]
          );
        },
      }
    );

    // 5. Atualiza com dados do YouTube
    const finalStatus = upload.scheduled_at ? 'scheduled' : 'uploaded';
    await query(
      `UPDATE uploads
       SET status=$1, youtube_video_id=$2, youtube_url=$3, uploaded_at=NOW(), failure_reason=NULL
       WHERE id=$4`,
      [finalStatus, videoId, videoUrl, uploadId]
    );

    // 6. Remove arquivo local
    cleanupClipFile(upload.file_path);
    await query("UPDATE clips SET file_path=NULL WHERE id=$1", [upload.clip_id]);

    return { videoId, videoUrl, status: finalStatus };
  } catch (err) {
    const failureReason = `[${err.status || err.code || 'ERR'}] ${err.message}`;
    await query(
      "UPDATE uploads SET status='failed', failure_reason=$1 WHERE id=$2",
      [failureReason, uploadId]
    );
    throw err;
  }
}

/**
 * Reprocessa manualmente um upload em status 'failed' via fila BullMQ.
 * Remove o job antigo da fila (BullMQ rejeita jobId duplicado) e re-enfileira.
 */
async function retryUpload(uploadId) {
  const result = await query('SELECT * FROM uploads WHERE id=$1', [uploadId]);
  const upload = result.rows[0];

  if (!upload) throw Object.assign(new Error('Upload não encontrado'), { status: 404 });
  if (upload.status !== 'failed') {
    throw Object.assign(
      new Error(`Upload não está em status failed (atual: ${upload.status})`),
      { status: 400 }
    );
  }

  // Remove job antigo da fila (evita conflito de jobId duplicado no BullMQ)
  await removeUploadJob(uploadId);

  // Volta para queued e enfileira via BullMQ (respeita concurrency e quota YouTube)
  await query(
    "UPDATE uploads SET status='queued', retry_count=retry_count+1, failure_reason=NULL WHERE id=$1",
    [uploadId]
  );

  await enqueueUpload(uploadId);
  return { uploadId, status: 'queued' };
}

async function getUpload(uploadId) {
  const result = await query('SELECT * FROM uploads WHERE id=$1', [uploadId]);
  return result.rows[0] || null;
}

async function listUploads(status = null) {
  if (status) {
    const result = await query('SELECT * FROM uploads WHERE status=$1 ORDER BY created_at DESC LIMIT 50', [status]);
    return result.rows;
  }
  const result = await query('SELECT * FROM uploads ORDER BY created_at DESC LIMIT 50');
  return result.rows;
}

module.exports = { processUpload, retryUpload, getUpload, listUploads };
