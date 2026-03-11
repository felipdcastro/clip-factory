const { query } = require('../db/connection');
const { processTranscription } = require('../modules/transcriber/transcription.service');

const POLL_INTERVAL_MS = 30 * 1000; // 30 segundos
let isRunning = false;

/**
 * Worker que detecta jobs com status 'downloaded' e inicia transcrição
 */
async function runTranscriptionWorker() {
  if (isRunning) return;
  isRunning = true;

  try {
    const result = await query(
      "SELECT id FROM jobs WHERE status='downloaded' ORDER BY created_at ASC LIMIT 1"
    );

    if (result.rows.length > 0) {
      const jobId = result.rows[0].id;
      console.log(`🎙️  Worker: iniciando transcrição do job ${jobId}`);
      await processTranscription(jobId);
    }
  } catch (err) {
    console.error('Transcription worker error:', err.message);
  } finally {
    isRunning = false;
  }
}

function startTranscriptionWorker() {
  console.log('🎙️  Transcription worker iniciado (intervalo: 30s)');
  setInterval(runTranscriptionWorker, POLL_INTERVAL_MS);
  // Executa imediatamente na primeira vez
  runTranscriptionWorker();
}

module.exports = { startTranscriptionWorker };
