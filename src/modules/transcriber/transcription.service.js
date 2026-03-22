const { query } = require('../../db/connection');
const { extractAudio, cleanupAudio } = require('./audio-extractor');
const { transcribeAudio } = require('./assemblyai.service');
const logger = require('../../utils/logger').child({ module: 'transcriber' });

const ASSEMBLYAI_COST_PER_HOUR = 0.37;

/**
 * Pipeline completo: extrai áudio → transcreve → salva no banco
 */
async function processTranscription(jobId) {
  // 1. Busca job com arquivo de vídeo
  const jobResult = await query('SELECT * FROM jobs WHERE id=$1', [jobId]);
  const job = jobResult.rows[0];

  if (!job || job.status !== 'downloaded') {
    throw new Error(`Job ${jobId} não está no status 'downloaded' (atual: ${job?.status})`);
  }

  if (!job.file_path) {
    throw new Error(`Job ${jobId} não tem arquivo de vídeo`);
  }

  // 2. Atualiza status
  await query("UPDATE jobs SET status='transcribing', updated_at=NOW() WHERE id=$1", [jobId]);

  let audioPath = null;
  try {
    // 3. Extrai áudio
    audioPath = await extractAudio(job.file_path, jobId);

    // 4. Transcreve
    const result = await transcribeAudio(audioPath);

    // 5. Calcula custo estimado
    const durationHours = (result.audio_duration || job.duration_seconds || 0) / 3600;
    const estimatedCost = parseFloat((durationHours * ASSEMBLYAI_COST_PER_HOUR).toFixed(4));
    logger.info({ job_id: jobId, estimated_cost_usd: estimatedCost }, `Job ${jobId} — custo estimado transcrição: $${estimatedCost}`);

    // 6. Salva transcrição
    await query(
      `INSERT INTO transcriptions (job_id, text, words, duration_seconds, estimated_cost_usd)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        jobId,
        result.text,
        JSON.stringify(result.words || []),
        result.audio_duration || job.duration_seconds,
        estimatedCost,
      ]
    );

    // 7. Atualiza status do job
    await query("UPDATE jobs SET status='transcribed', updated_at=NOW() WHERE id=$1", [jobId]);

    logger.info({ job_id: jobId }, `Job ${jobId} transcrito com sucesso`);

    // Publica na fila de análise imediatamente
    const { enqueueAnalysis } = require('../../queues');
    await enqueueAnalysis(jobId);

    return result;
  } catch (err) {
    // Garante que o job não fica preso em 'transcribing' em caso de falha
    await query(
      "UPDATE jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2",
      [err.message, jobId]
    ).catch(() => {}); // ignora erro secundário de DB
    throw err;
  } finally {
    // Cleanup do áudio temporário sempre executa
    if (audioPath) cleanupAudio(audioPath);
  }
}

async function getTranscription(jobId) {
  const result = await query(
    'SELECT * FROM transcriptions WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',
    [jobId]
  );
  return result.rows[0] || null;
}

module.exports = { processTranscription, getTranscription };
