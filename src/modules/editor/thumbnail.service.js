'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const CACHE_DIR = path.resolve(process.env.TEMP_DIR || './tmp', 'thumbnails');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function toFfmpegPath(p) {
  return p ? p.replace(/\\/g, '/') : p;
}

/**
 * Extrai um frame do vídeo como JPEG e salva em cache.
 * Retorna o path do arquivo JPEG gerado.
 * Lança erro se o vídeo não existir ou FFmpeg falhar.
 */
async function generateThumbnail(videoPath, startTime, cacheKey) {
  const cachePath = path.join(CACHE_DIR, `thumb_${cacheKey}.jpg`);

  if (fs.existsSync(cachePath)) return cachePath;

  if (!fs.existsSync(videoPath)) {
    throw Object.assign(new Error('Arquivo de vídeo não encontrado'), { status: 404 });
  }

  const offset = Math.max(0, startTime);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, [
      '-ss', String(offset),
      '-i', toFfmpegPath(videoPath),
      '-frames:v', '1',
      '-vf', 'scale=480:-2',
      '-q:v', '4',
      '-y',
      cachePath,
    ]);

    proc.stderr.on('data', () => {});

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout ao gerar thumbnail'));
    }, 15000);

    proc.on('close', code => {
      clearTimeout(timeout);
      if (code === 0 && fs.existsSync(cachePath)) {
        resolve();
      } else {
        reject(new Error(`FFmpeg encerrou com código ${code}`));
      }
    });

    proc.on('error', err => { clearTimeout(timeout); reject(err); });
  });

  return cachePath;
}

module.exports = { generateThumbnail };
