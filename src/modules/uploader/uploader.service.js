'use strict';

const pLimit = require('p-limit');
const { query } = require('../../db/connection');
const { uploadToYouTube, cleanupClipFile } = require('./youtube-upload.service');
const { isAuthenticated } = require('./youtube-auth.service');
const { withRetry } = require('../../utils/retry');

// Throttle: máx 1 upload simultâneo (quota YouTube API)
const limit = pLimit(1);

const MAX_UPLOAD_ATTEMPTS = 3;

/**
 * Processa um upload agendado com retry automático (backoff exponencial).
 */
async function processUpload(uploadId) {
  // 1. Busca upload + clip
  const result = await query(
    `SELECT u.*, c.file_path, c.type as clip_type
     FROM uploads u
     JOIN clips c ON c.id = u.clip_id
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
    const { videoId, videoUrl } = await withRetry(
      () => limit(() =>
        uploadToYouTube(
          upload.file_path,
          upload.title,
          upload.description,
          upload.clip_type,
          upload.scheduled_at
        )
      ),
      {
        maxAttempts: MAX_UPLOAD_ATTEMPTS,
        baseDelayMs: 1000,
        onRetry: async ({ attempt, error, nextRetryInMs }) => {
          console.log(
            `[uploader] Upload ${uploadId} falhou (tentativa ${attempt}/${MAX_UPLOAD_ATTEMPTS}). ` +
            `Erro: ${error.message}. Retry em ${nextRetryInMs}ms`
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
 * Reprocessa manualmente um upload em status 'failed'.
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

  // Volta para queued e dispara processamento
  await query(
    "UPDATE uploads SET status='queued', failure_reason=NULL WHERE id=$1",
    [uploadId]
  );

  return processUpload(uploadId);
}

async function getUpload(uploadId) {
  const result = await query('SELECT * FROM uploads WHERE id=$1', [uploadId]);
  return result.rows[0] || null;
}

async function listUploads() {
  const result = await query('SELECT * FROM uploads ORDER BY created_at DESC LIMIT 50');
  return result.rows;
}

module.exports = { processUpload, retryUpload, getUpload, listUploads };
