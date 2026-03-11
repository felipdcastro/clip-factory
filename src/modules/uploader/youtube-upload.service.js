const { google } = require('googleapis');
const fs = require('fs');
const { getAuthenticatedClient } = require('./youtube-auth.service');

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

  console.log(`📤 Iniciando upload: ${title} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: resource,
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  const videoId = response.data.id;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`✅ Upload concluído: ${videoUrl}`);
  return { videoId, videoUrl };
}

/**
 * Remove arquivo local após upload bem-sucedido
 */
function cleanupClipFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️  Arquivo removido: ${filePath}`);
    }
  } catch (err) {
    console.warn(`Falha ao remover arquivo ${filePath}:`, err.message);
  }
}

module.exports = { uploadToYouTube, cleanupClipFile, buildVideoMetadata };
