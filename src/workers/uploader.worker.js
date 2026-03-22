'use strict';

const { Worker } = require('bullmq');
const { processUpload } = require('../modules/uploader/uploader.service');
const { connection, QUEUE_NAMES } = require('../queues');
const logger = require('../utils/logger').child({ module: 'uploader-worker' });

let worker = null;

function startUploaderWorker() {
  worker = new Worker(
    QUEUE_NAMES.UPLOAD,
    async (job) => {
      const { uploadId } = job.data;
      logger.info({ upload_id: uploadId, bull_job_id: job.id }, `Processando upload ${uploadId}`);
      await processUpload(uploadId);
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
