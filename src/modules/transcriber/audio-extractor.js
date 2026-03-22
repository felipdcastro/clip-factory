const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger').child({ module: 'audio-extractor' });

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

/**
 * Extrai áudio de um arquivo de vídeo em formato WAV (16kHz mono)
 * Ideal para speech recognition
 * @returns {Promise<string>} caminho do arquivo WAV gerado
 */
function toFfmpegPath(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function extractAudio(videoPath, jobId) {
  const absVideoPath = path.resolve(videoPath);
  if (!fs.existsSync(absVideoPath)) {
    return Promise.reject(new Error(`Arquivo de vídeo não encontrado: ${absVideoPath}`));
  }

  return new Promise((resolve, reject) => {
    const outputPath = path.join(TEMP_DIR, `job_${jobId}_audio.wav`);

    ffmpeg(toFfmpegPath(videoPath))
      .noVideo()
      .audioChannels(1)        // mono
      .audioFrequency(16000)   // 16kHz — padrão speech recognition
      .audioCodec('pcm_s16le') // WAV sem compressão
      .output(toFfmpegPath(outputPath))
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`FFmpeg falhou: ${err.message}`)))
      .run();
  });
}

/**
 * Remove arquivo de áudio temporário
 */
function cleanupAudio(audioPath) {
  try {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  } catch (err) {
    logger.warn({ err, audio_path: audioPath }, `Falha ao remover áudio temporário`);
  }
}

module.exports = { extractAudio, cleanupAudio };
