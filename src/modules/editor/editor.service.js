const pLimit = require('p-limit');
const fs = require('fs');
const path = require('path');
const { query } = require('../../db/connection');
const { cutClip } = require('./ffmpeg.service');
const { detectFaceCropOffset } = require('./face-detector');
const { translateLinesToPt } = require('../analyzer/openai.service');

const CONTENT_TYPES_REQUIRING_TRANSLATION = new Set(['slap-battles']);

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

/**
 * Converte ms para timestamp ASS: H:MM:SS.cs
 */
function msToAssTime(ms) {
  const h  = Math.floor(ms / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function escapeAssText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\{/g, '\\{');
}

/**
 * Agrupa palavras em linhas de legenda respeitando limites de palavras e duração
 * Retorna array de { words, text, start, end }
 */
function groupWordsIntoLines(clipWords, wordsPerLine, maxLineMs) {
  const lines = [];
  let group = [];
  let groupStart = clipWords[0].start;

  clipWords.forEach((w, i) => {
    group.push(w);
    const isLast = i === clipWords.length - 1;
    if (group.length >= wordsPerLine || (w.end - groupStart) >= maxLineMs || isLast) {
      lines.push({ words: [...group], text: group.map(g => g.text).join(' '), start: groupStart, end: w.end + 150 });
      group = [];
      if (!isLast) groupStart = clipWords[i + 1].start;
    }
  });

  return lines;
}

/**
 * Gera arquivo ASS com karaoke word-by-word highlight
 * Palavras ativas ficam em amarelo; inativas em branco semitransparente
 */
function generateASS(words, clipStartSec, clipEndSec, outputPath, type) {
  const clipStartMs = clipStartSec * 1000;
  const clipEndMs   = clipEndSec * 1000;

  const clipWords = words
    .filter(w => w.start >= clipStartMs && w.end <= clipEndMs)
    .map(w => ({
      text:  w.text,
      start: w.start - clipStartMs,
      end:   w.end   - clipStartMs,
    }));

  if (!clipWords.length) return null;

  const isVertical    = type === 'reel';
  const playResX      = isVertical ? 1080  : 1920;
  const playResY      = isVertical ? 1920  : 1080;
  const fontSize      = isVertical ? 65    : 52;
  const marginV       = isVertical ? 140   : 55;
  const wordsPerLine  = isVertical ? 3     : 4;
  const maxLineMs     = isVertical ? 2000  : 2500;

  const lines = groupWordsIntoLines(clipWords, wordsPerLine, maxLineMs);

  // Cores ASS: formato &HAABBGGRR
  // Amarelo #FFE500 → R=FF G=E5 B=00 → 00 00 E5 FF
  const primaryColor   = '&H0000E5FF'; // palavra ativa → amarelo
  const secondaryColor = '&H60FFFFFF'; // palavra inativa → branco dim

  const header = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${primaryColor},${secondaryColor},&H00000000,&H80000000,-1,0,0,0,100,100,0.5,0,3,2.5,1,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogues = lines.map(line => {
    let text   = '';
    let cursor = line.start;

    line.words.forEach(w => {
      const gapMs = w.start - cursor;
      if (gapMs > 20) {
        text += `{\\k${Math.round(gapMs / 10)}} `;
      }
      const durCs = Math.max(1, Math.round((w.end - w.start) / 10));
      text += `{\\kf${durCs}}${escapeAssText(w.text)} `;
      cursor = w.end;
    });

    return `Dialogue: 0,${msToAssTime(line.start)},${msToAssTime(line.end)},Default,,0,0,0,,${text.trim()}`;
  });

  fs.writeFileSync(outputPath, `${header}\n${dialogues.join('\n')}\n`, 'utf8');
  return outputPath;
}

/**
 * Gera ASS com legendas traduzidas para PT-BR (sem karaoke — estático por linha).
 * Usa o mesmo agrupamento de palavras do generateASS, mas traduz via GPT.
 */
async function generateASSTranslated(words, clipStartSec, clipEndSec, outputPath, type) {
  const clipStartMs = clipStartSec * 1000;
  const clipEndMs   = clipEndSec * 1000;

  const clipWords = words
    .filter(w => w.start >= clipStartMs && w.end <= clipEndMs)
    .map(w => ({
      text:  w.text,
      start: w.start - clipStartMs,
      end:   w.end   - clipStartMs,
    }));

  if (!clipWords.length) return null;

  const isVertical   = type === 'reel';
  const playResX     = isVertical ? 1080 : 1920;
  const playResY     = isVertical ? 1920 : 1080;
  const fontSize     = isVertical ? 65   : 52;
  const marginV      = isVertical ? 140  : 55;
  const wordsPerLine = isVertical ? 3    : 4;
  const maxLineMs    = isVertical ? 2000 : 2500;

  const lines = groupWordsIntoLines(clipWords, wordsPerLine, maxLineMs);

  const translatedLines = await translateLinesToPt(lines);

  const primaryColor = '&H0000E5FF';
  const header = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${primaryColor},${primaryColor},&H00000000,&H80000000,-1,0,0,0,100,100,0.5,0,3,2.5,1,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogues = translatedLines.map(line =>
    `Dialogue: 0,${msToAssTime(line.start)},${msToAssTime(line.end)},Default,,0,0,0,,${escapeAssText(line.text)}`
  );

  fs.writeFileSync(outputPath, `${header}\n${dialogues.join('\n')}\n`, 'utf8');
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
    `SELECT cs.*, j.file_path as video_path, j.duration_seconds, j.content_type
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

  // 3. Cria ou reutiliza registro do clip (evita órfãos em retries BullMQ)
  const existingClip = await query(
    `SELECT * FROM clips WHERE suggestion_id=$1 AND status IN ('cutting','failed') ORDER BY created_at DESC LIMIT 1`,
    [suggestionId]
  );
  let clip;
  if (existingClip.rows[0]) {
    clip = existingClip.rows[0];
    await query("UPDATE clips SET status='cutting' WHERE id=$1", [clip.id]);
  } else {
    const clipResult = await query(
      `INSERT INTO clips (suggestion_id, job_id, type, status)
       VALUES ($1, $2, $3, 'cutting') RETURNING *`,
      [suggestionId, suggestion.job_id, suggestion.type]
    );
    clip = clipResult.rows[0];
  }

  const clipStart = parseFloat(suggestion.start_time);
  const clipEnd   = parseFloat(suggestion.end_time);

  // Face detection para crop inteligente em reels
  let cropCenterX = 0.5;
  if (suggestion.type === 'reel') {
    cropCenterX = await detectFaceCropOffset(suggestion.video_path, clipStart, clipEnd);
  }

  // Gera legendas ASS: traduzidas (PT) para conteúdo em inglês, karaoke para os demais
  const assFilePath = path.join(TEMP_DIR, `clip_${clip.id}.ass`);
  let assPath = null;
  if (words.length) {
    if (CONTENT_TYPES_REQUIRING_TRANSLATION.has(suggestion.content_type)) {
      assPath = await generateASSTranslated(words, clipStart, clipEnd, assFilePath, suggestion.type);
    } else {
      assPath = generateASS(words, clipStart, clipEnd, assFilePath, suggestion.type);
    }
  }

  const startMs = Date.now();

  try {
    // 4. Corta o vídeo com legendas (enfileirado com p-limit)
    const filePath = await limit(() =>
      cutClip(
        suggestion.video_path,
        suggestion.job_id,
        clip.id,
        clipStart,
        clipEnd,
        suggestion.type,
        assPath,
        cropCenterX
      )
    );

    const durationMs = Date.now() - startMs;
    require('../../utils/logger').child({ module: 'editor' }).info({ clip_id: clip.id, duration_ms: durationMs, type: suggestion.type, cropCenterX }, `Clip ${clip.id} pronto`);

    // Remove ASS temporário
    if (assPath && fs.existsSync(assPath)) fs.unlinkSync(assPath);

    // 5. Atualiza clip como ready
    await query(
      `UPDATE clips SET status='ready', file_path=$1, duration_ms=$2 WHERE id=$3`,
      [filePath, durationMs, clip.id]
    );

    return { ...clip, file_path: filePath, status: 'ready', duration_ms: durationMs };
  } catch (err) {
    if (assPath && fs.existsSync(assPath)) fs.unlinkSync(assPath);
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
