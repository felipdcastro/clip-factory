'use strict';

const path = require('path');
const fs   = require('fs');
const { extractAudio, cleanupAudio } = require('../transcriber/audio-extractor');
const { transcribeAudio }            = require('../transcriber/assemblyai.service');
const logger = require('../../utils/logger').child({ module: 'subtitle-service' });

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

/**
 * Converte palavras AssemblyAI para SRT
 * Agrupa em linhas de até MAX_CHARS caracteres, máximo MAX_DUR_MS de duração
 */
const MAX_CHARS  = 42;
const MAX_DUR_MS = 4000;

function wordsToSrt(words) {
  if (!words || !words.length) return '';

  const lines = [];
  let group = [];

  function flush() {
    if (!group.length) return;
    const text  = group.map(w => w.text).join(' ');
    const start = group[0].start;
    const end   = group[group.length - 1].end;
    lines.push({ text, start, end });
    group = [];
  }

  for (const word of words) {
    const candidate = [...group, word].map(w => w.text).join(' ');
    const dur = group.length ? word.end - group[0].start : 0;
    if (group.length && (candidate.length > MAX_CHARS || dur > MAX_DUR_MS)) {
      flush();
    }
    group.push(word);
  }
  flush();

  return lines.map((l, i) => {
    const fmt = ms => {
      const h  = Math.floor(ms / 3600000);
      const m  = Math.floor((ms % 3600000) / 60000);
      const s  = Math.floor((ms % 60000) / 1000);
      const cs = Math.floor((ms % 1000) / 10);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(cs).padStart(3,'0')}`;
    };
    return `${i + 1}\n${fmt(l.start)} --> ${fmt(l.end)}\n${l.text}\n`;
  }).join('\n');
}

/**
 * Transcreve um vídeo e gera um arquivo SRT em português.
 * @param {string} videoPath - caminho do arquivo de vídeo
 * @param {string} prefix    - prefixo para nomear os arquivos temporários
 * @returns {Promise<string>} caminho do arquivo .srt gerado
 */
async function generateSubtitles(videoPath, prefix) {
  logger.info({ video_path: videoPath }, 'Gerando legendas em português');

  let audioPath = null;
  const srtPath = path.join(TEMP_DIR, `${prefix}_subs.srt`);

  try {
    audioPath = await extractAudio(videoPath, prefix);
    const result = await transcribeAudio(audioPath, 'pt');

    const srt = wordsToSrt(result.words || []);
    if (!srt) throw new Error('Transcrição retornou sem palavras — legendas não geradas');

    fs.writeFileSync(srtPath, srt, 'utf8');
    logger.info({ srt_path: srtPath, lines: (srt.match(/^\d+$/gm) || []).length }, 'SRT gerado');
    return srtPath;
  } finally {
    if (audioPath) cleanupAudio(audioPath);
  }
}

module.exports = { generateSubtitles };
