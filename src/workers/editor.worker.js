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
      const { suggestionId } = job.data;
      logger.info({ suggestion_id: suggestionId, bull_job_id: job.id }, `Cortando clip ${suggestionId}`);
      await processClip(suggestionId);
    },
    {
      connection,
      concurrency: 2, // máx 2 cortes simultâneos (alinhado com p-limit anterior)
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
