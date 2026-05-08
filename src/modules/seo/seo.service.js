'use strict';

const path = require('path');
const fs   = require('fs');
const { query }            = require('../../db/connection');
const { runSEOAnalyst }    = require('./seo-analyst');
const { runSEOCopywriter } = require('./seo-copywriter');
const { runThumbnailAnalyst } = require('./thumbnail-analyst');
const logger = require('../../utils/logger').child({ module: 'seo-service' });

const THUMB_CACHE_DIR = path.resolve(process.env.TEMP_DIR || './tmp', 'thumbnails');

/**
 * Executa o SEO Squad completo para uma sugestão:
 * 1. SEO Analyst   (keyword strategy + score)
 * 2. SEO Copywriter + Thumbnail Analyst em paralelo
 * Salva resultados em clip_suggestions e retorna o resultado consolidado.
 */
async function runSEOSquad(suggestionId) {
  const sugResult = await query(
    `SELECT cs.id, cs.title, cs.reason, cs.clip_category, cs.type,
            cs.start_time, cs.end_time,
            j.content_type, j.title AS video_title
     FROM clip_suggestions cs
     JOIN jobs j ON j.id = cs.job_id
     WHERE cs.id = $1`,
    [suggestionId]
  );

  if (!sugResult.rows.length) {
    throw Object.assign(new Error('Sugestão não encontrada'), { status: 404 });
  }
  const s = sugResult.rows[0];

  const txResult = await query(
    `SELECT words FROM transcriptions
     WHERE job_id = (SELECT job_id FROM clip_suggestions WHERE id=$1)
     ORDER BY created_at DESC LIMIT 1`,
    [suggestionId]
  );
  const words = txResult.rows[0]?.words || [];

  const ctx = {
    contentType:  s.content_type,
    clipTitle:    s.title,
    clipReason:   s.reason,
    clipCategory: s.clip_category,
    videoTitle:   s.video_title,
  };

  logger.info({ suggestion_id: suggestionId, content_type: s.content_type }, 'SEO Squad iniciado');

  // Fase 1: Analyst (fornece keywords para o Copywriter)
  const analystResult = await runSEOAnalyst(ctx);

  // Fase 2: Copywriter + Thumbnail Analyst em paralelo
  const [copywriterResult, thumbnailResult] = await Promise.all([
    runSEOCopywriter({ ...ctx, analystResult }),
    runThumbnailAnalyst({
      words,
      clipStartSec: parseFloat(s.start_time),
      clipEndSec:   parseFloat(s.end_time),
      contentType:  s.content_type,
      clipReason:   s.reason,
    }),
  ]);

  // Invalida cache de thumbnail anterior para forçar regeneração com novo offset
  const oldThumbPath = path.join(THUMB_CACHE_DIR, `thumb_${suggestionId}.jpg`);
  if (fs.existsSync(oldThumbPath)) fs.unlinkSync(oldThumbPath);

  await query(
    `UPDATE clip_suggestions
     SET seo_title=$1, seo_description=$2, seo_tags=$3,
         thumbnail_offset_sec=$4, seo_score=$5
     WHERE id=$6`,
    [
      copywriterResult.title,
      copywriterResult.description,
      JSON.stringify(analystResult.tags || []),
      thumbnailResult.offsetSec,
      analystResult.seoScore,
      suggestionId,
    ]
  );

  logger.info({
    suggestion_id: suggestionId,
    seo_score: analystResult.seoScore,
    thumb_offset: thumbnailResult.offsetSec,
    seo_title: copywriterResult.title,
  }, 'SEO Squad concluído');

  return {
    seoTitle:           copywriterResult.title,
    seoDescription:     copywriterResult.description,
    seoTags:            analystResult.tags || [],
    seoScore:           analystResult.seoScore,
    strategy:           analystResult.strategy,
    thumbnailOffsetSec: thumbnailResult.offsetSec,
    thumbnailRationale: thumbnailResult.rationale,
  };
}

module.exports = { runSEOSquad };
