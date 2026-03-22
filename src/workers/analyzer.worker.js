'use strict';

const { Worker } = require('bullmq');
const { query } = require('../db/connection');
const { processAnalysis } = require('../modules/analyzer/analyzer.service');
const { connection, QUEUE_NAMES } = require('../queues');
const logger = require('../utils/logger').child({ module: 'analyzer-worker' });

let worker = null;

async function resetStuckJobs() {
  const result = await query(
    `UPDATE jobs SET status='transcribed', updated_at=NOW()
     WHERE status='analyzing'
       AND updated_at < NOW() - INTERVAL '10 minutes'
     RETURNING id`
  );
  if (result.rows.length > 0) {
    logger.warn({ job_ids: result.rows.map(r => r.id) }, `${result.rows.length} job(s) presos resetados para 'transcribed'`);
  }
}

function startAnalyzerWorker() {
  resetStuckJobs().catch(err => logger.error({ err }, 'Erro ao resetar jobs presos'));

  worker = new Worker(
    QUEUE_NAMES.ANALYSIS,
    async (job) => {
      const { jobId } = job.data;
      logger.info({ job_id: jobId, bull_job_id: job.id }, `Analisando job ${jobId}`);
      await processAnalysis(jobId);
    },
    {
      connection,
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ bull_job_id: job.id, job_id: job.data.jobId }, 'Análise concluída');
  });

  worker.on('failed', (job, err) => {
    logger.error({ err, bull_job_id: job?.id, job_id: job?.data?.jobId }, 'Análise falhou');
  });

  logger.info('Analyzer worker iniciado (BullMQ)');
  return worker;
}

async function stopAnalyzerWorker() {
  if (worker) {
    await worker.close();
    logger.info('Analyzer worker encerrado');
  }
}

module.exports = { startAnalyzerWorker, stopAnalyzerWorker };
