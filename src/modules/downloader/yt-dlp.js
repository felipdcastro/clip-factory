const ytDlpExec = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = process.env.TEMP_DIR || './tmp';
const MAX_DURATION_SECONDS = 3 * 60 * 60; // 3 horas

/**
 * Retorna opções extras com cookies se configurado
 */
function getCookiesOptions() {
  const cookiesPath = process.env.YOUTUBE_COOKIES_PATH;
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    return { cookies: cookiesPath };
  }

  // Se tiver cookies como string na env, salva em arquivo temporário
  const cookiesContent = process.env.YOUTUBE_COOKIES;
  if (cookiesContent) {
    const tmpCookies = path.join(TEMP_DIR, 'yt-cookies.txt');
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    fs.writeFileSync(tmpCookies, cookiesContent);
    return { cookies: tmpCookies };
  }

  return {};
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
  const info = await ytDlpExec(url, {
    dumpSingleJson: true,
    noWarnings: true,
    preferFreeFormats: true,
    skipDownload: true,
    ...getCookiesOptions(),
  });

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
  const outputTemplate = path.join(TEMP_DIR, `job_${jobId}_%(id)s.%(ext)s`);

  await ytDlpExec(url, {
    output: outputTemplate,
    format: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]/best',
    mergeOutputFormat: 'mp4',
    noWarnings: true,
    ...getCookiesOptions(),
  });

  // Encontrar o arquivo gerado
  const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`job_${jobId}_`));
  if (!files.length) {
    throw new Error('Arquivo de vídeo não encontrado após download');
  }

  return path.join(TEMP_DIR, files[0]);
}

module.exports = { isValidYouTubeUrl, getVideoMetadata, downloadVideo, MAX_DURATION_SECONDS };
