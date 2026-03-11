const { query } = require('../../db/connection');
const { analyzeTranscription } = require('./openai.service');

const MIN_CLIP_SECONDS = 30;
const MAX_VIDEO_SECONDS = 10 * 60; // 10 min
const MAX_REEL_SECONDS = 90;       // 90s

/**
 * Valida uma sugestão retornada pelo GPT
 */
function validateSuggestion(s, jobDuration) {
  if (typeof s.start_time !== 'number' || typeof s.end_time !== 'number') return false;
  if (s.start_time < 0) return false;
  if (s.end_time <= s.start_time) return false;
  if (jobDuration && s.end_time > jobDuration) return false;

  const duration = s.end_time - s.start_time;
  if (duration < MIN_CLIP_SECONDS) return false;

  if (s.type === 'video' && duration > MAX_VIDEO_SECONDS) return false;
  if (s.type === 'reel' && duration > MAX_REEL_SECONDS) return false;
  if (!['video', 'reel'].includes(s.type)) return false;
  if (!s.title || typeof s.title !== 'string') return false;

  return true;
}

/**
 * Pipeline completo: busca transcrição → analisa → salva sugestões
 */
async function processAnalysis(jobId) {
  // 1. Busca job
  const jobResult = await query('SELECT * FROM jobs WHERE id=$1', [jobId]);
  const job = jobResult.rows[0];

  if (!job || job.status !== 'transcribed') {
    throw new Error(`Job ${jobId} não está no status 'transcribed' (atual: ${job?.status})`);
  }

  // 2. Busca transcrição
  const txResult = await query(
    'SELECT * FROM transcriptions WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',
    [jobId]
  );
  const transcription = txResult.rows[0];

  if (!transcription) {
    throw new Error(`Job ${jobId} não tem transcrição salva`);
  }

  // 3. Atualiza status
  await query("UPDATE jobs SET status='analyzing', updated_at=NOW() WHERE id=$1", [jobId]);

  try {
    const words = typeof transcription.words === 'string'
      ? JSON.parse(transcription.words)
      : transcription.words || [];

    // 4. Chama GPT
    const rawSuggestions = await analyzeTranscription(
      transcription.text,
      words,
      job.duration_seconds
    );

    // 5. Valida e filtra sugestões
    const validSuggestions = rawSuggestions.filter(s => validateSuggestion(s, job.duration_seconds));

    if (validSuggestions.length === 0) {
      throw new Error('GPT não retornou sugestões válidas');
    }

    // 6. Salva no banco
    for (const s of validSuggestions) {
      await query(
        `INSERT INTO clip_suggestions (job_id, start_time, end_time, title, reason, type, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [jobId, s.start_time, s.end_time, s.title.substring(0, 100), s.reason, s.type]
      );
    }

    // 7. Atualiza status
    await query("UPDATE jobs SET status='analyzed', updated_at=NOW() WHERE id=$1", [jobId]);

    const videoCount = validSuggestions.filter(s => s.type === 'video').length;
    const reelCount = validSuggestions.filter(s => s.type === 'reel').length;
    console.log(`✅ Job ${jobId} analisado — ${videoCount} vídeos + ${reelCount} reels sugeridos`);

    return validSuggestions;
  } catch (err) {
    await query(
      "UPDATE jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2",
      [err.message, jobId]
    );
    throw err;
  }
}

async function getSuggestions(jobId) {
  const result = await query(
    'SELECT * FROM clip_suggestions WHERE job_id=$1 ORDER BY start_time ASC',
    [jobId]
  );
  return result.rows;
}

async function updateSuggestionStatus(suggestionId, status) {
  const valid = ['pending', 'approved', 'rejected'];
  if (!valid.includes(status)) {
    throw Object.assign(new Error(`Status inválido: ${status}`), { status: 400 });
  }

  const result = await query(
    'UPDATE clip_suggestions SET status=$1 WHERE id=$2 RETURNING *',
    [status, suggestionId]
  );

  if (!result.rows.length) {
    throw Object.assign(new Error('Sugestão não encontrada'), { status: 404 });
  }

  return result.rows[0];
}

module.exports = { processAnalysis, getSuggestions, updateSuggestionStatus, validateSuggestion };
