'use strict';

const fs = require('fs');
const { Worker } = require('bullmq');
const { query } = require('../db/connection');
const { processTranscription } = require('../modules/transcriber/transcription.service');
const { connection, QUEUE_NAMES } = require('../queues');
const logger = require('../utils/logger').child({ module: 'transcription-worker' });

let worker = null;

/**
 * Marca como failed jobs cujo arquivo de vídeo não existe mais no disco.
 * Evita loop infinito de reset → transcribing → reset.
 */
async function failJobsWithMissingFiles() {
  const result = await query(
    `SELECT id, file_path FROM jobs WHERE status IN ('downloaded','transcribing') AND file_path IS NOT NULL`
  );
  const missing = result.rows.filter(r => !fs.existsSync(r.file_path));
  if (!missing.length) return;

  const ids = missing.map(r => r.id);
  await query(
    `UPDATE jobs SET status='failed', error_message='Arquivo de vídeo não encontrado no disco', updated_at=NOW()
     WHERE id = ANY($1)`,
    [ids]
  );
  logger.warn({ job_ids: ids }, `${ids.length} job(s) marcados como failed (arquivo ausente)`);
}

/**
 * Reseta jobs presos em 'transcribing' há mais de 10 minutos de volta para 'downloaded'
 */
async function resetStuckJobs() {
  await failJobsWithMissingFiles();

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

let stuckJobsInterval = null;

function startTranscriptionWorker() {
  resetStuckJobs().catch(err => logger.error({ err }, 'Erro ao resetar jobs presos'));

  // Roda periodicamente — não apenas no startup
  stuckJobsInterval = setInterval(
    () => resetStuckJobs().catch(err => logger.error({ err }, 'Erro ao resetar jobs presos')),
    5 * 60 * 1000 // a cada 5 minutos
  );

  worker = new Worker(
    QUEUE_NAMES.TRANSCRIPTION,
    async (job) => {
      const { jobId, correlationId } = job.data;
      const logCtx = { job_id: jobId, bull_job_id: job.id };
      if (correlationId) logCtx.correlation_id = correlationId;
      logger.info(logCtx, `Iniciando transcrição do job ${jobId}`);
      await processTranscription(jobId);
    },
    {
      connection,
      concurrency: 1, // uma transcrição por vez (AssemblyAI tem limites)
    }
  );

  worker.on('completed', (job) => {
    logger.info({ bull_job_id: job.id, job_id: job.data.jobId }, 'Transcrição concluída');
  });

  worker.on('failed', (job, err) => {
    logger.error({ err, bull_job_id: job?.id, job_id: job?.data?.jobId }, 'Transcrição falhou');
  });

  logger.info('Transcription worker iniciado (BullMQ)');
  return worker;
}

async function stopTranscriptionWorker() {
  if (stuckJobsInterval) { clearInterval(stuckJobsInterval); stuckJobsInterval = null; }
  if (worker) {
    await worker.close();
    logger.info('Transcription worker encerrado');
  }
}

module.exports = { startTranscriptionWorker, stopTranscriptionWorker };
