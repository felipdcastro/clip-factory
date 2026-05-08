const { google } = require('googleapis');
const fs = require('fs');
const { getAuthenticatedClient } = require('./youtube-auth.service');
const logger = require('../../utils/logger').child({ module: 'uploader' });

const TAGS_BY_CONTENT_TYPE = {
  'lol-esports':     ['League of Legends', 'LoL', 'esports', 'CBLOL', 'highlights', 'cortes'],
  mbl:               ['MBL', 'Movimento Brasil Livre', 'política brasileira', 'cortes', 'Brasil'],
  'batalha-de-rima': ['batalha de rima', 'rap', 'freestyle', 'rima', 'cortes', 'Brasil'],
  toguro:            ['Toguro', 'Toguro live', 'stream', 'highlights', 'cortes'],
  comedia:           ['comédia', 'stand-up', 'humor brasileiro', 'engraçado', 'cortes'],
};
const DEFAULT_TAGS = ['cortes', 'brasil', 'highlights'];

const CATEGORY_BY_CONTENT_TYPE = {
  'lol-esports':     '20', // Gaming
  mbl:               '25', // News & Politics
  'batalha-de-rima': '10', // Music
  toguro:            '20', // Gaming
  comedia:           '23', // Comedy
};

/**
 * Prepara metadados do vídeo para a API do YouTube
 */
function buildVideoMetadata(title, description, type, scheduledAt, tags, contentType) {
  const isReel = type === 'reel';

  // Shorts: adiciona #Shorts ao título e descrição
  const finalTitle = isReel && !title.includes('#Shorts')
    ? `${title} #Shorts`
    : title;

  const baseDesc = description || '';
  const finalDescription = isReel && !baseDesc.includes('#Shorts')
    ? `${baseDesc}\n\n#Shorts`.trim()
    : baseDesc;

  // Tags: prioriza tags do argumento, depois fallback por content_type
  const finalTags = (Array.isArray(tags) && tags.length)
    ? tags
    : (TAGS_BY_CONTENT_TYPE[contentType] || DEFAULT_TAGS);

  const categoryId = CATEGORY_BY_CONTENT_TYPE[contentType] || '25'; // 25 = News & Politics (default)

  const resource = {
    snippet: {
      title: finalTitle.substring(0, 100),
      description: finalDescription,
      tags: finalTags,
      categoryId,
    },
    status: {
      privacyStatus: scheduledAt ? 'private' : 'public',
      selfDeclaredMadeForKids: false,
    },
  };

  // Agendamento de publicação
  if (scheduledAt) {
    resource.status.publishAt = new Date(scheduledAt).toISOString();
  }

  return resource;
}

/**
 * Faz upload de um arquivo de vídeo para o YouTube
 * Usa upload resumable (obrigatório para arquivos > 5MB)
 */
async function uploadToYouTube(filePath, title, description, type, scheduledAt, tags, contentType) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const fileSize = fs.statSync(filePath).size;
  const resource = buildVideoMetadata(title, description, type, scheduledAt, tags, contentType);

  logger.info({ title, size_mb: parseFloat((fileSize / 1024 / 1024).toFixed(1)) }, `Iniciando upload: ${title}`);

  const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos — suficiente para vídeos grandes
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: resource,
    media: {
      body: fs.createReadStream(filePath),
    },
  }, { timeout: UPLOAD_TIMEOUT_MS });

  const videoId = response.data.id;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  logger.info({ video_id: videoId, video_url: videoUrl }, `Upload concluído`);
  return { videoId, videoUrl };
}

/**
 * Remove arquivo local após upload bem-sucedido
 */
function cleanupClipFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info({ file_path: filePath }, `Arquivo removido após upload`);
    }
  } catch (err) {
    logger.warn({ err, file_path: filePath }, `Falha ao remover arquivo`);
  }
}

module.exports = { uploadToYouTube, cleanupClipFile, buildVideoMetadata };
