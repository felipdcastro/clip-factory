'use strict';

const { Worker } = require('bullmq');
const { query } = require('../db/connection');
const { processTranscription } = require('../modules/transcriber/transcription.service');
const { connection, QUEUE_NAMES } = require('../queues');
const logger = require('../utils/logger').child({ module: 'transcription-worker' });

let worker = null;

/**
 * Reseta jobs presos em 'transcribing' há mais de 10 minutos de volta para 'downloaded'
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

function startTranscriptionWorker() {
  resetStuckJobs().catch(err => logger.error({ err }, 'Erro ao resetar jobs presos'));

  worker = new Worker(
    QUEUE_NAMES.TRANSCRIPTION,
    async (job) => {
      const { jobId } = job.data;
      logger.info({ job_id: jobId, bull_job_id: job.id }, `Iniciando transcrição do job ${jobId}`);
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
  if (worker) {
    await worker.close();
    logger.info('Transcription worker encerrado');
  }
}

module.exports = { startTranscriptionWorker, stopTranscriptionWorker };
