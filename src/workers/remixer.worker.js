'use strict';

const { Worker } = require('bullmq');
const { processRemix } = require('../modules/remixer/remixer.service');
const { connection, QUEUE_NAMES } = require('../queues');
const logger = require('../utils/logger').child({ module: 'remixer-worker' });

let worker = null;

function startRemixerWorker() {
  worker = new Worker(
    QUEUE_NAMES.REMIX,
    async (job) => {
      const { remixId } = job.data;
      logger.info({ remix_id: remixId, bull_job_id: job.id }, `Aplicando efeitos no remix ${remixId}`);
      await processRemix(remixId);
    },
    {
      connection,
      concurrency: 1,       // FFmpeg é CPU-intensivo — 1 remix por vez
      lockDuration: 600000, // 10 min de lock (efeitos em clips longos podem demorar)
    }
  );

  worker.on('completed', (job) => {
    logger.info({ bull_job_id: job.id, remix_id: job.data.remixId }, 'Remix concluído');
  });

  worker.on('failed', (job, err) => {
    logger.error({ err, bull_job_id: job?.id, remix_id: job?.data?.remixId }, 'Remix falhou no worker');
  });

  logger.info('Remixer worker iniciado (BullMQ)');
  return worker;
}

async function stopRemixerWorker() {
  if (worker) {
    await worker.close();
    logger.info('Remixer worker encerrado');
  }
}

module.exports = { startRemixerWorker, stopRemixerWorker };
