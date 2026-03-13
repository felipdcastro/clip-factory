const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = process.env.TEMP_DIR || './tmp';
const MAX_DURATION_SECONDS = 3 * 60 * 60; // 3 horas
const YT_DLP_BIN = process.env.YT_DLP_PATH || 'yt-dlp';

/**
 * Executa yt-dlp com os argumentos fornecidos
 * Retorna stdout como string
 */
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_BIN, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp falhou (código ${code}): ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Não foi possível executar yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Retorna argumentos de cookies se configurado
 */
function getCookiesArgs() {
  const cookiesPath = process.env.YOUTUBE_COOKIES_PATH;
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    return ['--cookies', cookiesPath];
  }

  const cookiesContent = process.env.YOUTUBE_COOKIES;
  if (cookiesContent) {
    const tmpCookies = path.join(TEMP_DIR, 'yt-cookies.txt');
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    fs.writeFileSync(tmpCookies, cookiesContent);
    return ['--cookies', tmpCookies];
  }

  return [];
}

/**
 * Valida se a URL é do YouTube
 */
function isValidYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    const validHosts = ['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com'];
    return validHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Busca metadados do vídeo sem fazer download
 */
async function getVideoMetadata(url) {
  const args = [
    url,
    '--dump-single-json',
    '--no-warnings',
    '--skip-download',
    '--extractor-args', 'youtube:player_client=android,web',
    ...getCookiesArgs(),
  ];

  const output = await runYtDlp(args);
  const info = JSON.parse(output);

  return {
    title: info.title,
    duration_seconds: info.duration,
    thumbnail_url: info.thumbnail,
    channel_name: info.channel || info.uploader,
    video_id: info.id,
  };
}

/**
 * Faz download do vídeo no formato mp4 (máx 1080p)
 * Retorna o caminho do arquivo baixado
 */
async function downloadVideo(url, jobId) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const outputTemplate = path.join(TEMP_DIR, `job_${jobId}_%(id)s.%(ext)s`);

  const args = [
    url,
    '--output', outputTemplate,
    '--format', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=android,web',
    ...getCookiesArgs(),
  ];

  await runYtDlp(args);

  const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`job_${jobId}_`));
  if (!files.length) {
    throw new Error('Arquivo de vídeo não encontrado após download');
  }

  return path.join(TEMP_DIR, files[0]);
}

module.exports = { isValidYouTubeUrl, getVideoMetadata, downloadVideo, MAX_DURATION_SECONDS };
