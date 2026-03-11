const { query } = require('../db/connection');
const { processAnalysis } = require('../modules/analyzer/analyzer.service');

const POLL_INTERVAL_MS = 30 * 1000;
let isRunning = false;

async function runAnalyzerWorker() {
  if (isRunning) return;
  isRunning = true;

  try {
    const result = await query(
      "SELECT id FROM jobs WHERE status='transcribed' ORDER BY created_at ASC LIMIT 1"
    );

    if (result.rows.length > 0) {
      const jobId = result.rows[0].id;
      console.log(`🤖 Analyzer worker: analisando job ${jobId}`);
      await processAnalysis(jobId);
    }
  } catch (err) {
    console.error('Analyzer worker error:', err.message);
  } finally {
    isRunning = false;
  }
}

function startAnalyzerWorker() {
  console.log('🤖 Analyzer worker iniciado (intervalo: 30s)');
  setInterval(runAnalyzerWorker, POLL_INTERVAL_MS);
  runAnalyzerWorker();
}

module.exports = { startAnalyzerWorker };
