const { query } = require('../../db/connection');
const { analyzeTranscription, VALID_CLIP_CATEGORIES } = require('./openai.service');
const logger = require('../../utils/logger').child({ module: 'analyzer' });

const CATEGORY_PREFIX_RE = /^\[CATEGORY:\s*(highlight|educational|funny)\]\s*/;

const LIMITS_BY_CONTENT_TYPE = {
  mbl:               { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 720  },
  'batalha-de-rima': { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 1200 },
  toguro:            { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 720  },
  'lol-esports':     { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 600  },
  comedia:           { minReel: 30, maxReel: 90,  minVideo: 180,  maxVideo: 720  },
  sinuca:            { minReel: 20, maxReel: 90,  minVideo: 120,  maxVideo: 480  },
  'slap-battles':    { minReel: 15, maxReel: 90,  minVideo: 120,  maxVideo: 600  },
};

/**
 * Calcula limites efetivos considerando a duração real do vídeo.
 * Para vídeos longos, permite clips maiores (até 40% da duração ou 40min).
 */
function getEffectiveLimits(contentType, jobDuration) {
  const base = LIMITS_BY_CONTENT_TYPE[contentType] || LIMITS_BY_CONTENT_TYPE.mbl;
  if (!jobDuration || jobDuration < 300) return base;

  const dynamicMaxVideo = Math.min(
    Math.floor(jobDuration * 0.4),  // máx 40% da duração
    2400                             // teto absoluto: 40 minutos
  );

  return { ...base, maxVideo: Math.max(base.maxVideo, dynamicMaxVideo) };
}

/**
 * Valida uma sugestão retornada pelo GPT
 */
function validateSuggestion(s, jobDuration, contentType = 'mbl') {
  if (typeof s.start_time !== 'number' || typeof s.end_time !== 'number') return false;
  if (s.start_time < 0) return false;
  if (s.end_time <= s.start_time) return false;
  if (jobDuration && s.end_time > jobDuration) return false;

  const limits = getEffectiveLimits(contentType, jobDuration);
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

    // 4. Chama GPT — usa duration da transcrição se job.duration_seconds for null
    const durationSeconds = job.duration_seconds || transcription.duration_seconds || null;
    const { suggestions: rawSuggestions, costUsd } = await analyzeTranscription(
      transcription.text,
      words,
      durationSeconds,
      job.content_type
    );

    // Salva custo OpenAI no job
    if (costUsd > 0) {
      await query(
        'UPDATE jobs SET estimated_cost_usd=$1, updated_at=NOW() WHERE id=$2',
        [parseFloat(costUsd.toFixed(6)), jobId]
      );
    }

    // 5. Valida e filtra sugestões
    let validSuggestions = rawSuggestions.filter(s => validateSuggestion(s, job.duration_seconds, job.content_type));
    const dropped = rawSuggestions.length - validSuggestions.length;
    if (dropped > 0) {
      const limits = LIMITS_BY_CONTENT_TYPE[job.content_type] || LIMITS_BY_CONTENT_TYPE.mbl;
      logger.warn({
        dropped,
        raw_count: rawSuggestions.length,
        valid_count: validSuggestions.length,
        limits,
        dropped_items: rawSuggestions
          .filter(s => !validateSuggestion(s, job.duration_seconds, job.content_type))
          .map(s => ({ type: s.type, duration: Math.round(s.end_time - s.start_time), start: s.start_time, end: s.end_time })),
      }, 'Sugestões filtradas pela validação de duração');
    }

    if (validSuggestions.length === 0) {
      const limits = getEffectiveLimits(job.content_type, job.duration_seconds);
      logger.warn({
        raw_count: rawSuggestions.length,
        content_type: job.content_type,
        duration_seconds: job.duration_seconds,
        limits,
        raw_suggestions: rawSuggestions.map(s => ({
          type: s.type,
          duration: Math.round(s.end_time - s.start_time),
          start: s.start_time,
          end: s.end_time,
        })),
      }, 'Todas as sugestões foram filtradas — iniciando retry com hint corretivo');

      // Retry 1: GPT com feedback explícito sobre os limites violados
      const failureDetails = rawSuggestions.length > 0
        ? rawSuggestions.map(s => {
            const dur = Math.round(s.end_time - s.start_time);
            const expected = s.type === 'reel'
              ? `${limits.minReel}-${limits.maxReel}s`
              : `${limits.minVideo}-${limits.maxVideo}s`;
            return `  - ${s.type} "${(s.title || '').substring(0, 40)}" tem ${dur}s (esperado: ${expected})`;
          }).join('\n')
        : '  - Nenhuma sugestão retornada';

      const retryHint = `CORREÇÃO NECESSÁRIA: Suas sugestões anteriores foram rejeitadas por durações fora do intervalo. Limites obrigatórios:\n- "video": MÍNIMO ${limits.minVideo}s e MÁXIMO ${limits.maxVideo}s\n- "reel": MÍNIMO ${limits.minReel}s e MÁXIMO ${limits.maxReel}s\nProblemas:\n${failureDetails}\nAjuste start_time e end_time. Use apenas timestamps reais da transcrição.`;

      const { suggestions: retrySuggestions, costUsd: retryCost } = await analyzeTranscription(
        transcription.text,
        words,
        durationSeconds,
        job.content_type,
        retryHint
      );
      // Acumula custo do retry
      if (retryCost > 0) {
        await query(
          'UPDATE jobs SET estimated_cost_usd=COALESCE(estimated_cost_usd,0)+$1, updated_at=NOW() WHERE id=$2',
          [parseFloat(retryCost.toFixed(6)), jobId]
        );
      }
      const retryValid = retrySuggestions.filter(s => validateSuggestion(s, job.duration_seconds, job.content_type));

      if (retryValid.length > 0) {
        logger.info({ job_id: jobId, count: retryValid.length }, 'Retry GPT produziu sugestões válidas');
        validSuggestions = retryValid;
      } else {
        // Retry 2: limites relaxados em 30% para não perder o job inteiro
        const allRaw = [...rawSuggestions, ...retrySuggestions];
        const relaxed = allRaw.filter(s => {
          if (!['video', 'reel'].includes(s.type)) return false;
          if (typeof s.start_time !== 'number' || typeof s.end_time !== 'number') return false;
          if (s.end_time <= s.start_time) return false;
          const dur = s.end_time - s.start_time;
          return s.type === 'reel'
            ? dur >= limits.minReel * 0.7 && dur <= limits.maxReel * 1.3
            : dur >= limits.minVideo * 0.7 && dur <= limits.maxVideo * 1.3;
        });

        if (relaxed.length > 0) {
          logger.warn({ job_id: jobId, count: relaxed.length }, 'Usando limites relaxados (±30%) para recuperar sugestões após retry falhar');
          validSuggestions = relaxed;
        } else {
          throw new Error(`GPT retornou ${rawSuggestions.length} sugestão(ões), retry também falhou — nenhuma passou na validação mesmo com limites relaxados (video ${limits.minVideo}-${limits.maxVideo}s, reel ${limits.minReel}-${limits.maxReel}s)`);
        }
      }
    }

    // 6. Salva no banco
    for (const s of validSuggestions) {
      const suggestedTags = Array.isArray(s.suggested_tags) && s.suggested_tags.length
        ? JSON.stringify(s.suggested_tags)
        : null;
      await query(
        `INSERT INTO clip_suggestions
         (job_id, start_time, end_time, title, reason, type, clip_category, suggested_tags, suggested_description, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
        [
          jobId,
          s.start_time,
          s.end_time,
          s.title.substring(0, 100),
          s.reason,
          s.type,
          s.clip_category || null,
          suggestedTags,
          s.suggested_description || null,
        ]
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

async function getSuggestions(jobId, category) {
  const params = [jobId];
  const categoryClause = category ? ' AND cs.clip_category=$2' : '';
  if (category) params.push(category);

  const result = await query(
    `SELECT cs.*, c.id as clip_id, c.status as clip_status
     FROM clip_suggestions cs
     LEFT JOIN clips c ON c.suggestion_id = cs.id
     WHERE cs.job_id=$1${categoryClause}
     ORDER BY cs.start_time ASC`,
    params
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

/**
 * Migra sugestões legadas que têm [CATEGORY: X] no campo reason
 * para a coluna dedicada clip_category, limpando o prefixo de reason.
 */
async function backfillClipCategory() {
  const result = await query(
    `SELECT id, reason FROM clip_suggestions WHERE reason LIKE '[CATEGORY:%'`
  );

  let updated = 0;
  for (const row of result.rows) {
    const match = row.reason.match(CATEGORY_PREFIX_RE);
    if (!match) continue;

    const category = match[1];
    const cleanReason = row.reason.replace(CATEGORY_PREFIX_RE, '');

    await query(
      'UPDATE clip_suggestions SET clip_category=$1, reason=$2 WHERE id=$3',
      [category, cleanReason, row.id]
    );
    updated++;
  }

  logger.info({ updated }, 'Backfill clip_category concluído');
  return updated;
}

module.exports = { processAnalysis, getSuggestions, updateSuggestionStatus, validateSuggestion, backfillClipCategory };
