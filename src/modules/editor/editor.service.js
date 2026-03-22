const pLimit = require('p-limit');
const fs = require('fs');
const path = require('path');
const { query } = require('../../db/connection');
const { cutClip } = require('./ffmpeg.service');

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

/**
 * Converte ms para formato SRT: 00:00:01,234
 */
function msToSrt(ms) {
  const totalSec = Math.floor(ms / 1000);
  const millis = ms % 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(millis).padStart(3,'0')}`;
}

/**
 * Gera arquivo SRT a partir dos words da transcrição, ajustado para o trecho do clip
 */
function generateSRT(words, clipStartSec, clipEndSec, outputPath) {
  const clipStartMs = clipStartSec * 1000;
  const clipEndMs   = clipEndSec * 1000;

  // Filtra palavras do trecho e ajusta timestamps
  const clipWords = words
    .filter(w => w.start >= clipStartMs && w.end <= clipEndMs)
    .map(w => ({ text: w.text, start: w.start - clipStartMs, end: w.end - clipStartMs }));

  if (!clipWords.length) return null;

  // Agrupa em linhas de até 6 palavras ou 3 segundos
  const lines = [];
  let group = [];
  let groupStart = clipWords[0].start;

  clipWords.forEach((w, i) => {
    group.push(w);
    const groupDuration = w.end - groupStart;
    const isLast = i === clipWords.length - 1;

    if (group.length >= 6 || groupDuration >= 3000 || isLast) {
      lines.push({ start: groupStart, end: w.end, text: group.map(g => g.text).join(' ') });
      group = [];
      if (!isLast) groupStart = clipWords[i + 1].start;
    }
  });

  const srt = lines.map((l, i) =>
    `${i + 1}\n${msToSrt(l.start)} --> ${msToSrt(l.end)}\n${l.text}\n`
  ).join('\n');

  fs.writeFileSync(outputPath, srt, 'utf8');
  return outputPath;
}

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

  // 2. Busca palavras da transcrição para legendas
  const txResult = await query(
    'SELECT words FROM transcriptions WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',
    [suggestion.job_id]
  );
  const words = txResult.rows[0]?.words || [];

  // 3. Cria registro do clip no banco
  const clipResult = await query(
    `INSERT INTO clips (suggestion_id, job_id, type, status)
     VALUES ($1, $2, $3, 'cutting') RETURNING *`,
    [suggestionId, suggestion.job_id, suggestion.type]
  );
  const clip = clipResult.rows[0];

  // Gera SRT se tiver palavras
  const srtPath = words.length
    ? generateSRT(words, parseFloat(suggestion.start_time), parseFloat(suggestion.end_time),
        path.join(TEMP_DIR, `clip_${clip.id}.srt`))
    : null;

  const startMs = Date.now();

  try {
    // 4. Corta o vídeo com legendas (enfileirado com p-limit)
    const filePath = await limit(() =>
      cutClip(
        suggestion.video_path,
        suggestion.job_id,
        clip.id,
        parseFloat(suggestion.start_time),
        parseFloat(suggestion.end_time),
        suggestion.type,
        srtPath
      )
    );

    const durationMs = Date.now() - startMs;
    require('../../utils/logger').child({ module: 'editor' }).info({ clip_id: clip.id, duration_ms: durationMs, type: suggestion.type }, `Clip ${clip.id} pronto`);

    // Remove SRT temporário
    if (srtPath && fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

    // 5. Atualiza clip como ready
    await query(
      `UPDATE clips SET status='ready', file_path=$1, duration_ms=$2 WHERE id=$3`,
      [filePath, durationMs, clip.id]
    );

    return { ...clip, file_path: filePath, status: 'ready', duration_ms: durationMs };
  } catch (err) {
    if (srtPath && fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
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
