const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

function toFfmpegPath(p) {
  return p ? p.replace(/\\/g, '/') : p;
}

/**
 * Monta filtro de vídeo com legenda opcional
 */
function buildVideoFilter(baseFilter, srtPath) {
  if (!srtPath) return baseFilter;
  const escaped = toFfmpegPath(srtPath).replace(/:/g, '\\:');
  const style = [
    'FontName=Arial',
    'FontSize=22',
    'Bold=1',
    'PrimaryColour=&H00FFFFFF',   // branco
    'OutlineColour=&H00000000',   // contorno preto
    'Outline=3',
    'Shadow=1',
    'BorderStyle=3',              // caixa de fundo
    'BackColour=&H90000000',      // fundo preto semitransparente
    'Alignment=2',                // centro-baixo
    'MarginV=25',                 // distância da borda inferior
  ].join(',');
  return `${baseFilter},subtitles='${escaped}':force_style='${style}'`;
}

/**
 * Corta vídeo em formato 16:9 (horizontal) — padrão YouTube
 * Codec H.264 + AAC, máx 1080p, CRF 23
 */
function cutVideoHorizontal(inputPath, outputPath, startTime, endTime, srtPath) {
  return new Promise((resolve, reject) => {
    const vf = buildVideoFilter("scale='min(1920,iw)':-2", srtPath);
    ffmpeg(toFfmpegPath(inputPath))
      .seekInput(startTime)
      .duration(endTime - startTime)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        `-vf ${vf}`,
        '-movflags +faststart',
      ])
      .output(toFfmpegPath(outputPath))
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`FFmpeg (video) falhou: ${err.message}`)))
      .run();
  });
}

/**
 * Corta vídeo em formato 9:16 (vertical) — YouTube Shorts / Reels
 * Crop centralizado + resize para 1080x1920
 */
function cutVideoVertical(inputPath, outputPath, startTime, endTime, srtPath) {
  return new Promise((resolve, reject) => {
    const vf = buildVideoFilter('crop=ih*9/16:ih,scale=1080:1920', srtPath);
    ffmpeg(toFfmpegPath(inputPath))
      .seekInput(startTime)
      .duration(endTime - startTime)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        `-vf ${vf}`,
        '-movflags +faststart',
      ])
      .output(toFfmpegPath(outputPath))
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`FFmpeg (reel) falhou: ${err.message}`)))
      .run();
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
async function cutClip(inputPath, jobId, clipId, startTime, endTime, type, srtPath) {
  const outputPath = buildOutputPath(jobId, clipId, type);

  if (type === 'reel') {
    await cutVideoVertical(inputPath, outputPath, startTime, endTime, srtPath);
  } else {
    await cutVideoHorizontal(inputPath, outputPath, startTime, endTime, srtPath);
  }

  return outputPath;
}

module.exports = { cutClip, buildOutputPath };
