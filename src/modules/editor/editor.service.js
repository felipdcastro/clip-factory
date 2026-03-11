const pLimit = require('p-limit');
const { query } = require('../../db/connection');
const { cutClip } = require('./ffmpeg.service');

// Fila: máx 2 cortes simultâneos
const limit = pLimit(2);

/**
 * Processa o corte de uma sugestão aprovada
 */
async function processClip(suggestionId) {
  // 1. Busca sugestão e job
  const sugResult = await query(
    `SELECT cs.*, j.file_path as video_path, j.duration_seconds
     FROM clip_suggestions cs
     JOIN jobs j ON j.id = cs.job_id
     WHERE cs.id = $1`,
    [suggestionId]
  );
  const suggestion = sugResult.rows[0];

  if (!suggestion) {
    throw new Error(`Sugestão ${suggestionId} não encontrada`);
  }
  if (suggestion.status !== 'approved') {
    throw new Error(`Sugestão ${suggestionId} não está aprovada (status: ${suggestion.status})`);
  }
  if (!suggestion.video_path) {
    throw new Error(`Job ${suggestion.job_id} não tem arquivo de vídeo`);
  }

  // 2. Cria registro do clip no banco
  const clipResult = await query(
    `INSERT INTO clips (suggestion_id, job_id, type, status)
     VALUES ($1, $2, $3, 'cutting') RETURNING *`,
    [suggestionId, suggestion.job_id, suggestion.type]
  );
  const clip = clipResult.rows[0];

  const startMs = Date.now();

  try {
    // 3. Corta o vídeo (enfileirado com p-limit)
    const filePath = await limit(() =>
      cutClip(
        suggestion.video_path,
        suggestion.job_id,
        clip.id,
        parseFloat(suggestion.start_time),
        parseFloat(suggestion.end_time),
        suggestion.type
      )
    );

    const durationMs = Date.now() - startMs;
    console.log(`✂️  Clip ${clip.id} pronto em ${(durationMs / 1000).toFixed(1)}s — ${suggestion.type}`);

    // 4. Atualiza clip como ready
    await query(
      `UPDATE clips SET status='ready', file_path=$1, duration_ms=$2 WHERE id=$3`,
      [filePath, durationMs, clip.id]
    );

    return { ...clip, file_path: filePath, status: 'ready', duration_ms: durationMs };
  } catch (err) {
    await query(
      "UPDATE clips SET status='failed' WHERE id=$1",
      [clip.id]
    );
    throw err;
  }
}

async function getClip(clipId) {
  const result = await query('SELECT * FROM clips WHERE id=$1', [clipId]);
  return result.rows[0] || null;
}

module.exports = { processClip, getClip };
