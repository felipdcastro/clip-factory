const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const TEMP_DIR = process.env.TEMP_DIR || './tmp';

/**
 * Extrai áudio de um arquivo de vídeo em formato WAV (16kHz mono)
 * Ideal para speech recognition
 * @returns {Promise<string>} caminho do arquivo WAV gerado
 */
function extractAudio(videoPath, jobId) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(TEMP_DIR, `job_${jobId}_audio.wav`);

    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)        // mono
      .audioFrequency(16000)   // 16kHz — padrão speech recognition
      .audioCodec('pcm_s16le') // WAV sem compressão
      .output(outputPath)
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
    console.warn(`Falha ao remover áudio temporário ${audioPath}:`, err.message);
  }
}

module.exports = { extractAudio, cleanupAudio };
