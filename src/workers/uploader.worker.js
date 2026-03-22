const { query } = require('../db/connection');
const { processUpload } = require('../modules/uploader/uploader.service');
const logger = require('../utils/logger').child({ module: 'uploader-worker' });

const POLL_INTERVAL_MS = 60 * 1000; // 1 minuto

async function runUploaderWorker() {
  try {
    // Processa uploads na fila (respeitando scheduled_at — só publica quando a hora chegar)
    const result = await query(
      `SELECT id FROM uploads
       WHERE status = 'queued'
         AND (scheduled_at IS NULL OR scheduled_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 1`
    );

    if (result.rows.length > 0) {
      const uploadId = result.rows[0].id;
      logger.info({ upload_id: uploadId }, `Processando upload ${uploadId}`);
      await processUpload(uploadId);
    }
  } catch (err) {
    logger.error({ err }, 'Uploader worker error');
  }
}

function startUploaderWorker() {
  logger.info('Uploader worker iniciado (intervalo: 60s)');
  setInterval(runUploaderWorker, POLL_INTERVAL_MS);
  runUploaderWorker();
}

module.exports = { startUploaderWorker };
