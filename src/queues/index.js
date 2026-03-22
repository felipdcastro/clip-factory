'use strict';

const { Queue } = require('bullmq');
const logger = require('../utils/logger').child({ module: 'queues' });

const QUEUE_NAMES = {
  TRANSCRIPTION: 'transcription',
  ANALYSIS: 'analysis',
  EDITOR: 'editor',
  UPLOAD: 'upload',
};

// Conexão Redis compartilhada — lazy para não quebrar imports em testes
let connection = null;
let queues = null;

function getConnection() {
  if (!connection) {
    if (!process.env.REDIS_URL) {
      throw new Error(
        'REDIS_URL não configurado. Configure a variável de ambiente antes de iniciar o servidor.\n' +
        'Dica: docker run -d -p 6379:6379 redis:alpine'
      );
    }
    connection = {
      url: process.env.REDIS_URL,
      maxRetriesPerRequest: null, // obrigatório para BullMQ workers
    };
  }
  return connection;
}

function getQueues() {
  if (!queues) {
    const conn = getConnection();
    queues = {
      transcription: new Queue(QUEUE_NAMES.TRANSCRIPTION, { connection: conn }),
      analysis: new Queue(QUEUE_NAMES.ANALYSIS, { connection: conn }),
      editor: new Queue(QUEUE_NAMES.EDITOR, { connection: conn }),
      upload: new Queue(QUEUE_NAMES.UPLOAD, { connection: conn }),
    };
  }
  return queues;
}

/**
 * Adiciona job à fila de transcrição
 * @param {number} jobId
 */
async function enqueueTranscription(jobId) {
  await getQueues().transcription.add('transcribe', { jobId }, {
    jobId: `transcription-${jobId}`, // idempotente — evita duplicatas
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
  logger.info({ job_id: jobId }, `Job ${jobId} enfileirado para transcrição`);
}

/**
 * Adiciona job à fila de análise (GPT)
 * @param {number} jobId
 */
async function enqueueAnalysis(jobId) {
  await getQueues().analysis.add('analyze', { jobId }, {
    jobId: `analysis-${jobId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
  logger.info({ job_id: jobId }, `Job ${jobId} enfileirado para análise`);
}

/**
 * Adiciona sugestão à fila do editor (corte FFmpeg)
 * @param {number} suggestionId
 */
async function enqueueClip(suggestionId) {
  await getQueues().editor.add('cut', { suggestionId }, {
    jobId: `clip-${suggestionId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
  logger.info({ suggestion_id: suggestionId }, `Sugestão ${suggestionId} enfileirada para corte`);
}

/**
 * Adiciona upload à fila do uploader
 * @param {number} uploadId
 * @param {Date|null} scheduledAt
 */
async function enqueueUpload(uploadId, scheduledAt = null) {
  const delay = scheduledAt ? Math.max(0, new Date(scheduledAt) - Date.now()) : 0;
  await getQueues().upload.add('upload', { uploadId }, {
    jobId: `upload-${uploadId}`,
    delay,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
  logger.info({ upload_id: uploadId, delay_ms: delay }, `Upload ${uploadId} enfileirado`);
}

/**
 * Retorna status de todas as filas (waiting, active, failed, completed)
 */
async function getQueuesStatus() {
  const status = {};
  for (const [name, queue] of Object.entries(getQueues())) {
    const [waiting, active, failed, completed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
      queue.getCompletedCount(),
    ]);
    status[name] = { waiting, active, failed, completed };
  }
  return status;
}

/**
 * Fecha todas as filas e conexões graciosamente
 */
async function closeQueues() {
  if (queues) {
    await Promise.all(Object.values(queues).map(q => q.close()));
    queues = null;
    connection = null;
    logger.info('Filas fechadas');
  }
}

module.exports = {
  get queues() { return getQueues(); },
  get connection() { return getConnection(); },
  QUEUE_NAMES,
  enqueueTranscription,
  enqueueAnalysis,
  enqueueClip,
  enqueueUpload,
  getQueuesStatus,
  closeQueues,
};
