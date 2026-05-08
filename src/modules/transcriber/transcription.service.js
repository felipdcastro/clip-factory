const { query } = require('../../db/connection');
const { extractAudio, cleanupAudio } = require('./audio-extractor');
const { transcribeAudio } = require('./assemblyai.service');
const logger = require('../../utils/logger').child({ module: 'transcriber' });

const ASSEMBLYAI_COST_PER_HOUR = 0.37;

const CONTENT_TYPE_AUDIO_LANGUAGE = {
  'slap-battles': 'en',
};
const MAX_COST_USD = parseFloat(process.env.MAX_TRANSCRIPTION_COST_USD || '2.00');

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

  // 2. Guarda de custo — bloqueia antes de chamar a AssemblyAI
  if (job.duration_seconds) {
    const estimatedCost = parseFloat(((job.duration_seconds / 3600) * ASSEMBLYAI_COST_PER_HOUR).toFixed(4));
    if (estimatedCost > MAX_COST_USD) {
      throw new Error(
        `Job ${jobId} bloqueado: custo estimado $${estimatedCost} excede o limite de $${MAX_COST_USD} ` +
        `(vídeo de ${Math.round(job.duration_seconds / 60)} min). ` +
        `Ajuste MAX_TRANSCRIPTION_COST_USD para permitir vídeos mais longos.`
      );
    }
    logger.info({ job_id: jobId, estimated_cost_usd: estimatedCost, limit_usd: MAX_COST_USD }, 'Custo estimado dentro do limite — prosseguindo');
  } else {
    logger.warn({ job_id: jobId }, 'duration_seconds desconhecido — não foi possível validar custo antes da transcrição');
  }

  // 3. Atualiza status
  await query("UPDATE jobs SET status='transcribing', updated_at=NOW() WHERE id=$1", [jobId]);

  let audioPath = null;
  try {
    // 4. Extrai áudio
    audioPath = await extractAudio(job.file_path, jobId);

    // 5. Transcreve (idioma depende do content_type)
    const audioLang = CONTENT_TYPE_AUDIO_LANGUAGE[job.content_type] || null;
    const result = await transcribeAudio(audioPath, audioLang);

    // 6. Calcula custo real
    const durationHours = (result.audio_duration || job.duration_seconds || 0) / 3600;
    const estimatedCost = parseFloat((durationHours * ASSEMBLYAI_COST_PER_HOUR).toFixed(4));
    logger.info({ job_id: jobId, estimated_cost_usd: estimatedCost }, `Job ${jobId} — custo estimado transcrição: $${estimatedCost}`);

    // 7. Salva transcrição
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

    // 8. Atualiza status do job e salva duration_seconds
    const audioDuration = result.audio_duration || job.duration_seconds;
    await query(
      "UPDATE jobs SET status='transcribed', duration_seconds=$1, updated_at=NOW() WHERE id=$2",
      [audioDuration, jobId]
    );

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
    ).catch(dbErr => logger.error({ err: dbErr, job_id: jobId }, 'Falha ao atualizar status do job para failed'));
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
