'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');
const FFMPEG_TIMEOUT_MS = parseInt(process.env.FFMPEG_TIMEOUT_MS || '1800000'); // 30 min
const FFMPEG_CRF = parseInt(process.env.FFMPEG_CRF || '18');

function toFfmpegPath(p) {
  return p ? p.replace(/\\/g, '/') : p;
}

/**
 * Monta filtro de vídeo com legenda ASS karaoke opcional
 * Usa estilo embutido no arquivo ASS (sem force_style)
 */
function buildVideoFilter(baseFilter, assPath) {
  if (!assPath) return baseFilter;
  const escaped = toFfmpegPath(assPath).replace(/:/g, '\\:');
  return `${baseFilter},subtitles='${escaped}'`;
}

/**
 * Corta vídeo em formato 16:9 (horizontal) — padrão YouTube
 */
function cutVideoHorizontal(inputPath, outputPath, startTime, endTime, assPath) {
  const stderrLines = [];
  return new Promise((resolve, reject) => {
    const vf = buildVideoFilter("scale='min(1920,iw)':-2", assPath);
    const cmd = ffmpeg(toFfmpegPath(inputPath))
      .seekInput(startTime)
      .duration(endTime - startTime)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([`-crf ${FFMPEG_CRF}`, '-preset fast', `-vf ${vf}`, '-movflags +faststart'])
      .output(toFfmpegPath(outputPath))
      .on('stderr', (line) => stderrLines.push(line))
      .on('end', () => { clearTimeout(timer); resolve(outputPath); })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`FFmpeg (video) falhou: ${err.message}\n${stderrLines.slice(-20).join('\n')}`));
      });

    const timer = setTimeout(() => {
      cmd.kill('SIGKILL');
      reject(new Error(`FFmpeg timeout após ${FFMPEG_TIMEOUT_MS / 60000} minutos`));
    }, FFMPEG_TIMEOUT_MS);

    cmd.run();
  });
}

/**
 * Corta vídeo em formato 9:16 (vertical) — YouTube Shorts / Reels
 * cropCenterX: 0-1, posição horizontal do centro do crop (face detection)
 */
function cutVideoVertical(inputPath, outputPath, startTime, endTime, assPath, cropCenterX = 0.5) {
  const stderrLines = [];
  return new Promise((resolve, reject) => {
    const cx     = Math.max(0.2, Math.min(0.8, cropCenterX)).toFixed(4);
    const cropX  = `trunc((${cx}*iw-ih*9/16/2)/2)*2`;
    const cropVF = `crop=trunc(ih*9/16/2)*2:ih:${cropX}:0,scale=1080:1920`;
    const vf     = buildVideoFilter(cropVF, assPath);

    const cmd = ffmpeg(toFfmpegPath(inputPath))
      .seekInput(startTime)
      .duration(endTime - startTime)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([`-crf ${FFMPEG_CRF}`, '-preset fast', `-vf ${vf}`, '-movflags +faststart'])
      .output(toFfmpegPath(outputPath))
      .on('stderr', (line) => stderrLines.push(line))
      .on('end', () => { clearTimeout(timer); resolve(outputPath); })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`FFmpeg (reel) falhou: ${err.message}\n${stderrLines.slice(-20).join('\n')}`));
      });

    const timer = setTimeout(() => {
      cmd.kill('SIGKILL');
      reject(new Error(`FFmpeg timeout após ${FFMPEG_TIMEOUT_MS / 60000} minutos`));
    }, FFMPEG_TIMEOUT_MS);

    cmd.run();
  });
}

/**
 * Gera nome de arquivo de saída padronizado
 */
function buildOutputPath(jobId, clipId, type) {
  return path.join(TEMP_DIR, `${jobId}_${clipId}_${type}.mp4`);
}

/**
 * Corta clipe no formato correto baseado no tipo
 */
async function cutClip(inputPath, jobId, clipId, startTime, endTime, type, assPath, cropCenterX = 0.5) {
  const outputPath = buildOutputPath(jobId, clipId, type);

  if (type === 'reel') {
    await cutVideoVertical(inputPath, outputPath, startTime, endTime, assPath, cropCenterX);
  } else {
    await cutVideoHorizontal(inputPath, outputPath, startTime, endTime, assPath);
  }

  return outputPath;
}

module.exports = { cutClip, buildOutputPath };
