'use strict';

const { Worker, DelayedError } = require('bullmq');
const { processUpload } = require('../modules/uploader/uploader.service');
const { connection, QUEUE_NAMES } = require('../queues');
const { getCircuitBreaker } = require('../utils/circuit-breaker');
const logger = require('../utils/logger').child({ module: 'uploader-worker' });

const CIRCUIT_BREAKER_RETRY_DELAY_MS = parseInt(process.env.CIRCUIT_BREAKER_RETRY_DELAY_MS || '60000');

// Erros que NÃO indicam falha da YouTube API (não devem abrir o circuit)
const NON_API_ERROR_PATTERNS = [
  'não encontrado',
  'não está na fila',
  'YouTube não autorizado',
  'não tem arquivo',
];

function isYouTubeApiFailure(err) {
  const msg = err?.message ?? '';
  return !NON_API_ERROR_PATTERNS.some(p => msg.includes(p));
}

let worker = null;

function startUploaderWorker() {
  const cb = getCircuitBreaker();

  worker = new Worker(
    QUEUE_NAMES.UPLOAD,
    async (job, token) => {
      const { uploadId, correlationId } = job.data;

      // Circuit breaker check — antes de consumir quota da YouTube API
      const cbState = await cb.getState();
      if (cbState === 'OPEN') {
        logger.warn(
          { upload_id: uploadId, bull_job_id: job.id, retry_delay_ms: CIRCUIT_BREAKER_RETRY_DELAY_MS },
          'Circuit breaker OPEN — upload adiado sem chamar YouTube API'
        );
        await job.moveToDelayed(Date.now() + CIRCUIT_BREAKER_RETRY_DELAY_MS, token);
        throw new DelayedError('Circuit breaker OPEN');
      }

      const logCtx = { upload_id: uploadId, bull_job_id: job.id, cb_state: cbState };
      if (correlationId) logCtx.correlation_id = correlationId;
      logger.info(logCtx, `Processando upload ${uploadId}`);

      try {
        await processUpload(uploadId);
        await cb.recordSuccess();
      } catch (err) {
        if (isYouTubeApiFailure(err)) {
          await cb.recordFailure();
        }
        throw err;
      }
    },
    {
      connection,
      concurrency: 1, // máx 1 upload simultâneo (quota YouTube API)
    }
  );

  worker.on('completed', (job) => {
    logger.info({ bull_job_id: job.id, upload_id: job.data.uploadId }, 'Upload concluído');
  });

  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) return; // comportamento intencional do circuit breaker
    logger.error({ err, bull_job_id: job?.id, upload_id: job?.data?.uploadId }, 'Upload falhou');
  });

  logger.info('Uploader worker iniciado (BullMQ)');
  return worker;
}

async function stopUploaderWorker() {
  if (worker) {
    await worker.close();
    logger.info('Uploader worker encerrado');
  }
}

module.exports = { startUploaderWorker, stopUploaderWorker };
