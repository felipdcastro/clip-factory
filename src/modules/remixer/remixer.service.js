'use strict';

const fs   = require('fs');
const path = require('path');
const { query }             = require('../../db/connection');
const { applyEffects }      = require('./ffmpeg-effects.service');
const { generateSubtitles } = require('./subtitle.service');
const logger = require('../../utils/logger').child({ module: 'remixer' });

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

/**
 * Cria um registro de remix na fila e retorna o remix criado.
 * @param {number} clipId
 * @param {object} effects - { mirror, filter, zoom, speed }
 */
async function createRemix(clipId, effects) {
  const clipResult = await query(
    'SELECT id, file_path, type, job_id, suggestion_id FROM clips WHERE id=$1',
    [clipId]
  );
  if (!clipResult.rows.length) {
    throw Object.assign(new Error('Clip não encontrado'), { status: 404 });
  }
  const clip = clipResult.rows[0];
  if (clip.status !== 'ready' && clipResult.rows[0].status !== undefined) {
    // re-check with status
  }
  if (!clip.file_path || !fs.existsSync(clip.file_path)) {
    throw Object.assign(new Error('Arquivo do clip não encontrado no disco'), { status: 409 });
  }

  const remix = await query(
    `INSERT INTO clip_remixes (source_clip_id, effects, status)
     VALUES ($1, $2, 'pending') RETURNING *`,
    [clipId, JSON.stringify(effects)]
  );
  return remix.rows[0];
}

/**
 * Processa um remix: aplica efeitos FFmpeg, cria clip resultado e atualiza o remix.
 * Chamado pelo remixer.worker.
 * @param {number} remixId
 */
async function processRemix(remixId) {
  // 1. Busca remix + clip de origem
  const remixResult = await query(
    `SELECT r.*, c.file_path as source_path, c.type, c.job_id, c.suggestion_id
     FROM clip_remixes r
     JOIN clips c ON c.id = r.source_clip_id
     WHERE r.id = $1`,
    [remixId]
  );
  if (!remixResult.rows.length) {
    throw new Error(`Remix ${remixId} não encontrado`);
  }
  const remix = remixResult.rows[0];

  if (!remix.source_path || !fs.existsSync(remix.source_path)) {
    throw new Error(`Arquivo de origem não encontrado: ${remix.source_path}`);
  }

  // 2. Marca como processing
  await query("UPDATE clip_remixes SET status='processing' WHERE id=$1", [remixId]);

  // 3. Cria registro do clip resultado (status cutting) para poder referenciar no upload
  const resultClipRow = await query(
    `INSERT INTO clips (job_id, suggestion_id, type, status)
     VALUES ($1, $2, $3, 'cutting') RETURNING id`,
    [remix.job_id, remix.suggestion_id, remix.type]
  );
  const resultClipId = resultClipRow.rows[0].id;

  const outputPath = path.join(TEMP_DIR, `remix_${remixId}_${resultClipId}_${remix.type}.mp4`);

  let srtPath = null;
  try {
    // 4. Aplica efeitos via FFmpeg (com legendas se solicitado)
    const effects = remix.effects || {};
    logger.info({ remix_id: remixId, effects, type: remix.type }, 'Iniciando aplicação de efeitos');

    if (effects.subtitles) {
      logger.info({ remix_id: remixId }, 'Gerando legendas em português');
      srtPath = await generateSubtitles(remix.source_path, `remix_${remixId}`);
    }

    await applyEffects(remix.source_path, outputPath, effects, remix.type, srtPath);

    // 5. Mede duração do arquivo resultante
    const { size } = fs.statSync(outputPath);
    logger.info({ remix_id: remixId, output_size_bytes: size }, 'Efeitos aplicados com sucesso');

    // 6. Atualiza clip resultado para ready
    await query(
      "UPDATE clips SET status='ready', file_path=$1 WHERE id=$2",
      [outputPath, resultClipId]
    );

    // 7. Atualiza remix com resultado
    await query(
      "UPDATE clip_remixes SET status='ready', result_clip_id=$1 WHERE id=$2",
      [resultClipId, remixId]
    );

    if (srtPath && fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
    logger.info({ remix_id: remixId, result_clip_id: resultClipId }, 'Remix concluído');
    return { remixId, resultClipId, outputPath };

  } catch (err) {
    // Limpa arquivos temporários — ignora EBUSY (Windows: FFmpeg ainda segurando o handle)
    const safeUnlink = (p) => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} };
    safeUnlink(outputPath);
    safeUnlink(srtPath);

    await query("UPDATE clips SET status='failed' WHERE id=$1", [resultClipId]);
    await query(
      "UPDATE clip_remixes SET status='failed', failure_reason=$1 WHERE id=$2",
      [err.message, remixId]
    );

    logger.error({ remix_id: remixId, err }, 'Remix falhou');
    throw err;
  }
}

/**
 * Lista remixes com informações do clip de origem.
 */
async function listRemixes(limit = 50) {
  const result = await query(
    `SELECT r.*, c.type, cs.title as suggestion_title
     FROM clip_remixes r
     JOIN clips c ON c.id = r.source_clip_id
     LEFT JOIN clip_suggestions cs ON cs.id = c.suggestion_id
     ORDER BY r.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Retorna um remix pelo ID.
 */
async function getRemix(remixId) {
  const result = await query(
    `SELECT r.*, c.type
     FROM clip_remixes r
     JOIN clips c ON c.id = r.source_clip_id
     WHERE r.id = $1`,
    [remixId]
  );
  return result.rows[0] || null;
}

module.exports = { createRemix, processRemix, listRemixes, getRemix };
