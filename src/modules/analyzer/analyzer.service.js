const { query } = require('../../db/connection');
const { analyzeTranscription, VALID_CLIP_CATEGORIES } = require('./openai.service');
const logger = require('../../utils/logger').child({ module: 'analyzer' });

const LIMITS_BY_CONTENT_TYPE = {
  mbl:               { minReel: 45, maxReel: 60,  minVideo: 300,  maxVideo: 600  },
  'batalha-de-rima': { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 1200 },
  toguro:            { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 720  },
  'lol-esports':     { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 600  },
};

/**
 * Valida uma sugestão retornada pelo GPT
 */
function validateSuggestion(s, jobDuration, contentType = 'mbl') {
  if (typeof s.start_time !== 'number' || typeof s.end_time !== 'number') return false;
  if (s.start_time < 0) return false;
  if (s.end_time <= s.start_time) return false;
  if (jobDuration && s.end_time > jobDuration) return false;

  const limits = LIMITS_BY_CONTENT_TYPE[contentType] || LIMITS_BY_CONTENT_TYPE.mbl;
  const duration = s.end_time - s.start_time;
  if (s.type === 'reel' && (duration < limits.minReel || duration > limits.maxReel)) return false;
  if (s.type === 'video' && (duration < limits.minVideo || duration > limits.maxVideo)) return false;
  if (!['video', 'reel'].includes(s.type)) return false;
  if (!s.title || typeof s.title !== 'string') return false;
  if (s.clip_category !== undefined && !VALID_CLIP_CATEGORIES.includes(s.clip_category)) return false;

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
      job.duration_seconds,
      job.content_type
    );

    // 5. Valida e filtra sugestões
    const validSuggestions = rawSuggestions.filter(s => validateSuggestion(s, job.duration_seconds, job.content_type));

    if (validSuggestions.length === 0) {
      throw new Error('GPT não retornou sugestões válidas');
    }

    // 6. Salva no banco
    for (const s of validSuggestions) {
      const reason = s.clip_category
        ? `[CATEGORY: ${s.clip_category}] ${s.reason}`
        : s.reason;
      await query(
        `INSERT INTO clip_suggestions (job_id, start_time, end_time, title, reason, type, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [jobId, s.start_time, s.end_time, s.title.substring(0, 100), reason, s.type]
      );
    }

    // 7. Atualiza status
    await query("UPDATE jobs SET status='analyzed', updated_at=NOW() WHERE id=$1", [jobId]);

    const videoCount = validSuggestions.filter(s => s.type === 'video').length;
    const reelCount = validSuggestions.filter(s => s.type === 'reel').length;
    logger.info({ job_id: jobId, video_count: videoCount, reel_count: reelCount }, `Job ${jobId} analisado`);

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
    `SELECT cs.*, c.id as clip_id, c.status as clip_status
     FROM clip_suggestions cs
     LEFT JOIN clips c ON c.suggestion_id = cs.id
     WHERE cs.job_id=$1
     ORDER BY cs.start_time ASC`,
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
