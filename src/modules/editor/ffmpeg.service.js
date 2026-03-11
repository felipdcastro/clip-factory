const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const TEMP_DIR = process.env.TEMP_DIR || './tmp';

/**
 * Corta vídeo em formato 16:9 (horizontal) — padrão YouTube
 * Codec H.264 + AAC, máx 1080p, CRF 23
 */
function cutVideoHorizontal(inputPath, outputPath, startTime, endTime) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(endTime - startTime)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        '-vf scale=\'min(1920,iw)\':-2',  // máx 1080p, mantém aspect ratio
        '-movflags +faststart',            // otimiza para streaming
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`FFmpeg (video) falhou: ${err.message}`)))
      .run();
  });
}

/**
 * Corta vídeo em formato 9:16 (vertical) — YouTube Shorts / Reels
 * Crop centralizado + resize para 1080x1920
 */
function cutVideoVertical(inputPath, outputPath, startTime, endTime) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(endTime - startTime)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        '-vf crop=ih*9/16:ih,scale=1080:1920',  // crop central + resize
        '-movflags +faststart',
      ])
      .output(outputPath)
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
async function cutClip(inputPath, jobId, clipId, startTime, endTime, type) {
  const outputPath = buildOutputPath(jobId, clipId, type);

  if (type === 'reel') {
    await cutVideoVertical(inputPath, outputPath, startTime, endTime);
  } else {
    await cutVideoHorizontal(inputPath, outputPath, startTime, endTime);
  }

  return outputPath;
}

module.exports = { cutClip, buildOutputPath };
