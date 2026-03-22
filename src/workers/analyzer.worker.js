const { query } = require('../db/connection');
const { processAnalysis } = require('../modules/analyzer/analyzer.service');
const logger = require('../utils/logger').child({ module: 'analyzer-worker' });

const POLL_INTERVAL_MS = 30 * 1000;
let isRunning = false;

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

async function runAnalyzerWorker() {
  if (isRunning) return;
  isRunning = true;

  try {
    const result = await query(
      "SELECT id FROM jobs WHERE status='transcribed' ORDER BY created_at ASC LIMIT 1"
    );

    if (result.rows.length > 0) {
      const jobId = result.rows[0].id;
      logger.info({ job_id: jobId }, `Analisando job ${jobId}`);
      await processAnalysis(jobId);
    }
  } catch (err) {
    logger.error({ err }, 'Analyzer worker error');
  } finally {
    isRunning = false;
  }
}

function startAnalyzerWorker() {
  logger.info('Analyzer worker iniciado (intervalo: 30s)');
  resetStuckJobs().catch(err => logger.error({ err }, 'Erro ao resetar jobs presos'));
  setInterval(runAnalyzerWorker, POLL_INTERVAL_MS);
  runAnalyzerWorker();
}

module.exports = { startAnalyzerWorker };
