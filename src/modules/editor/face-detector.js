'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const logger = require('../../utils/logger').child({ module: 'face-detector' });

function toFfmpegPath(p) {
  return p ? p.replace(/\\/g, '/') : p;
}

/**
 * Extrai um frame do vídeo como buffer PPM
 */
function extractFrame(videoPath, timeOffset) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `cfface_${process.pid}_${Date.now()}.ppm`);

    const proc = spawn(ffmpegInstaller.path, [
      '-ss', String(timeOffset),
      '-i', toFfmpegPath(videoPath),
      '-frames:v', '1',
      '-vf', 'scale=320:-2',
      '-y',
      tmpFile,
    ]);

    proc.stderr.on('data', () => {});

    const timeout = setTimeout(() => { proc.kill(); resolve(null); }, 10000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) { resolve(null); return; }
      try {
        const data = fs.readFileSync(tmpFile);
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        resolve(data);
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => { clearTimeout(timeout); resolve(null); });
  });
}

/**
 * Parseia buffer PPM P6 (binary RGB)
 */
function parsePPM(buffer) {
  let pos = 0;

  function skipWS() {
    while (pos < buffer.length) {
      if (buffer[pos] === 35) { // '#' comment
        while (pos < buffer.length && buffer[pos] !== 10) pos++;
      } else if (buffer[pos] <= 32) {
        pos++;
      } else {
        break;
      }
    }
  }

  function readToken() {
    skipWS();
    let token = '';
    while (pos < buffer.length && buffer[pos] > 32) {
      token += String.fromCharCode(buffer[pos++]);
    }
    return token;
  }

  if (readToken() !== 'P6') return null;
  const width  = parseInt(readToken(), 10);
  const height = parseInt(readToken(), 10);
  readToken(); // maxVal
  if (pos < buffer.length && buffer[pos] <= 32) pos++;

  const pixelData = buffer.slice(pos);
  if (isNaN(width) || isNaN(height) || pixelData.length < width * height * 3) return null;
  return { width, height, pixelData };
}

/**
 * Calcula centroide horizontal usando detecção de tons de pele por RGB.
 * Muito mais preciso que luminância para localizar rostos.
 * Retorna valor normalizado 0-1 (0=esquerda, 0.5=centro, 1=direita).
 *
 * Critérios de pele (Kovac et al. 2003 + ajuste empírico):
 *   R > 95 && G > 40 && B > 20
 *   max(R,G,B) - min(R,G,B) > 15
 *   |R-G| > 15 && R > G && R > B
 */
function findSkinCentroid(ppmBuffer) {
  const parsed = parsePPM(ppmBuffer);
  if (!parsed) return null;

  const { width, height, pixelData } = parsed;

  // Analisa apenas a metade superior do frame (onde rostos aparecem)
  const roiEndRow = Math.floor(height * 0.75);

  let weightedX = 0;
  let skinPixels = 0;

  for (let py = 0; py < roiEndRow; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 3;
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);

      const isSkin =
        r > 95 && g > 40 && b > 20 &&
        maxC - minC > 15 &&
        Math.abs(r - g) > 15 &&
        r > g && r > b;

      if (isSkin) {
        weightedX += px;
        skinPixels++;
      }
    }
  }

  // Precisa de massa mínima de pele para ser confiável
  const minSkinRatio = 0.01; // 1% dos pixels da ROI
  if (skinPixels < width * roiEndRow * minSkinRatio) return null;

  return (weightedX / skinPixels) / width;
}

/**
 * Detecta a posição horizontal ideal para crop vertical (face-focused).
 * Retorna fração 0-1 representando o centro horizontal do crop.
 * Fallback gracioso: retorna 0.5 (centro) em qualquer erro.
 */
async function detectFaceCropOffset(videoPath, startTime, endTime) {
  const duration = endTime - startTime;
  if (duration < 2) return 0.5;

  // 5 amostras distribuídas no clipe, pesando mais o meio
  const sampleTimes = [
    startTime + duration * 0.2,
    startTime + duration * 0.35,
    startTime + duration * 0.5,
    startTime + duration * 0.65,
    startTime + duration * 0.8,
  ];

  const offsets = [];

  for (const t of sampleTimes) {
    try {
      const buf = await extractFrame(videoPath, t);
      if (!buf) continue;
      const skinOffset = findSkinCentroid(buf);
      if (skinOffset !== null) offsets.push(skinOffset);
    } catch { /* continue */ }
  }

  if (!offsets.length) {
    logger.warn({ videoPath, startTime, endTime }, 'face-detector: nenhum frame com pele detectada, usando centro (0.5)');
    return 0.5;
  }

  // Mediana para resistir a frames problemáticos
  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)];

  // Blend suave com o centro para evitar crop extremo
  const blended = median * 0.7 + 0.5 * 0.3;
  const result = Math.max(0.1, Math.min(0.9, blended));
  logger.debug({ videoPath, startTime, endTime, offsets, median, result }, 'face-detector: detecção concluída');
  return result;
}

module.exports = { detectFaceCropOffset };
