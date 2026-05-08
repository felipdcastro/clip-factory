'use strict';

const { Worker } = require('bullmq');
const { processClip } = require('../modules/editor/editor.service');
const { connection, QUEUE_NAMES } = require('../queues');
const logger = require('../utils/logger').child({ module: 'editor-worker' });

let worker = null;

function startEditorWorker() {
  worker = new Worker(
    QUEUE_NAMES.EDITOR,
    async (job) => {
      const { suggestionId, correlationId } = job.data;
      const logCtx = { suggestion_id: suggestionId, bull_job_id: job.id };
      if (correlationId) logCtx.correlation_id = correlationId;
      logger.info(logCtx, `Cortando clip ${suggestionId}`);
      await processClip(suggestionId);
    },
    {
      connection,
      concurrency: 1,       // 1 corte por vez: cortes demoram ~2min e são CPU-intensivos
      lockDuration: 600000, // 10 min — FFmpeg de reel leva ~115s; default 30s expirava antes de terminar
    }
  );

  worker.on('completed', (job) => {
    logger.info({ bull_job_id: job.id, suggestion_id: job.data.suggestionId }, 'Corte concluído');
  });

  worker.on('failed', (job, err) => {
    logger.error({ err, bull_job_id: job?.id, suggestion_id: job?.data?.suggestionId }, 'Corte falhou');
  });

  logger.info('Editor worker iniciado (BullMQ)');
  return worker;
}

async function stopEditorWorker() {
  if (worker) {
    await worker.close();
    logger.info('Editor worker encerrado');
  }
}

module.exports = { startEditorWorker, stopEditorWorker };
