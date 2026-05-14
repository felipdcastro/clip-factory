'use strict';

const { Queue } = require('bullmq');
const logger = require('../utils/logger').child({ module: 'queues' });

const QUEUE_NAMES = {
  TRANSCRIPTION: 'transcription',
  ANALYSIS: 'analysis',
  EDITOR: 'editor',
  UPLOAD: 'upload',
  REMIX: 'remix',
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
      remix: new Queue(QUEUE_NAMES.REMIX, { connection: conn }),
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
 * Adiciona remix à fila de efeitos
 * @param {number} remixId
 */
async function enqueueRemix(remixId) {
  await getQueues().remix.add('remix', { remixId }, {
    jobId: `remix-${remixId}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  });
  logger.info({ remix_id: remixId }, `Remix ${remixId} enfileirado`);
}

/**
 * Remove job de upload da fila (necessário antes de re-enfileirar — BullMQ rejeita jobId duplicado)
 * @param {number} uploadId
 */
async function removeUploadJob(uploadId) {
  const job = await getQueues().upload.getJob(`upload-${uploadId}`);
  if (job) await job.remove();
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

const QUEUE_ALERT_THRESHOLDS = {
  failed:  parseInt(process.env.QUEUE_ALERT_FAILED  || '10'),
  waiting: parseInt(process.env.QUEUE_ALERT_WAITING || '100'),
};

let healthMonitorInterval = null;

async function runQueueHealthCheck() {
  try {
    const status = await getQueuesStatus();
    for (const [name, counts] of Object.entries(status)) {
      if (counts.failed >= QUEUE_ALERT_THRESHOLDS.failed) {
        logger.error({ queue: name, failed: counts.failed }, `ALERTA: fila "${name}" tem ${counts.failed} jobs falhos (limite: ${QUEUE_ALERT_THRESHOLDS.failed})`);
      }
      if (counts.waiting >= QUEUE_ALERT_THRESHOLDS.waiting) {
        logger.warn({ queue: name, waiting: counts.waiting }, `ALERTA: fila "${name}" tem ${counts.waiting} jobs aguardando (limite: ${QUEUE_ALERT_THRESHOLDS.waiting})`);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Erro no health check das filas');
  }
}

function startQueueHealthMonitor(intervalMs = 5 * 60 * 1000) {
  if (healthMonitorInterval) return;
  healthMonitorInterval = setInterval(runQueueHealthCheck, intervalMs);
  logger.info({ interval_ms: intervalMs }, 'Queue health monitor iniciado');
}

function stopQueueHealthMonitor() {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
    healthMonitorInterval = null;
  }
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
  enqueueRemix,
  removeUploadJob,
  getQueuesStatus,
  startQueueHealthMonitor,
  stopQueueHealthMonitor,
  closeQueues,
};
