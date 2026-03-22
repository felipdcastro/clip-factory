const { google } = require('googleapis');
const fs = require('fs');
const { getAuthenticatedClient } = require('./youtube-auth.service');
const logger = require('../../utils/logger').child({ module: 'uploader' });

const DEFAULT_TAGS = ['política', 'MBL', 'cortes', 'brasil', 'politica brasileira'];
const CATEGORY_NEWS_POLITICS = '25';

/**
 * Prepara metadados do vídeo para a API do YouTube
 */
function buildVideoMetadata(title, description, type, scheduledAt) {
  const isReel = type === 'reel';

  // Shorts: adiciona #Shorts ao título e descrição
  const finalTitle = isReel && !title.includes('#Shorts')
    ? `${title} #Shorts`
    : title;

  const finalDescription = isReel
    ? `${description || ''}\n\n#Shorts #MBL #Política`.trim()
    : (description || '');

  const resource = {
    snippet: {
      title: finalTitle.substring(0, 100),
      description: finalDescription,
      tags: DEFAULT_TAGS,
      categoryId: CATEGORY_NEWS_POLITICS,
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
async function uploadToYouTube(filePath, title, description, type, scheduledAt) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const fileSize = fs.statSync(filePath).size;
  const resource = buildVideoMetadata(title, description, type, scheduledAt);

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
