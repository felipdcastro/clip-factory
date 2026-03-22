const { query } = require('../db/connection');
const { processTranscription } = require('../modules/transcriber/transcription.service');
const logger = require('../utils/logger').child({ module: 'transcription-worker' });

const POLL_INTERVAL_MS = 30 * 1000; // 30 segundos
let isRunning = false;

/**
 * Reseta jobs presos em 'transcribing' há mais de 10 minutos de volta para 'downloaded'
 * Protege contra crashes/reinicializações do servidor durante transcrição
 */
async function resetStuckJobs() {
  const result = await query(
    `UPDATE jobs SET status='downloaded', error_message=NULL, updated_at=NOW()
     WHERE status='transcribing'
       AND updated_at < NOW() - INTERVAL '10 minutes'
     RETURNING id`
  );
  if (result.rows.length > 0) {
    logger.warn({ job_ids: result.rows.map(r => r.id) }, `${result.rows.length} job(s) presos resetados para 'downloaded'`);
  }
}

/**
 * Worker que detecta jobs com status 'downloaded' e inicia transcrição
 */
async function runTranscriptionWorker() {
  if (isRunning) return;
  isRunning = true;

  try {
    const result = await query(
      "SELECT id FROM jobs WHERE status='downloaded' ORDER BY created_at ASC LIMIT 1"
    );

    if (result.rows.length > 0) {
      const jobId = result.rows[0].id;
      logger.info({ job_id: jobId }, `Iniciando transcrição do job ${jobId}`);
      await processTranscription(jobId);
    }
  } catch (err) {
    logger.error({ err }, 'Transcription worker error');
  } finally {
    isRunning = false;
  }
}

function startTranscriptionWorker() {
  logger.info('Transcription worker iniciado (intervalo: 30s)');
  resetStuckJobs().catch(err => logger.error({ err }, 'Erro ao resetar jobs presos'));
  setInterval(runTranscriptionWorker, POLL_INTERVAL_MS);
  // Executa imediatamente na primeira vez
  runTranscriptionWorker();
}

module.exports = { startTranscriptionWorker };
