'use strict';

const LOL_HASHTAGS = '#LoL #LeagueOfLegends';

const TAGS_BY_CONTENT_TYPE = {
  'lol-esports':     ['League of Legends', 'LoL', 'esports', 'CBLOL', 'highlights', 'cortes'],
  mbl:               ['MBL', 'Movimento Brasil Livre', 'política brasileira', 'cortes', 'Brasil'],
  'batalha-de-rima': ['batalha de rima', 'rap', 'freestyle', 'rima', 'cortes', 'Brasil'],
  toguro:            ['Toguro', 'Toguro live', 'stream', 'highlights', 'cortes'],
  comedia:           ['comédia', 'stand-up', 'humor brasileiro', 'engraçado', 'cortes'],
  'slap-battles':    ['slap battle', 'batalha de tapa', 'KO', 'knockout', 'nocaute', 'viral'],
};

/**
 * Descrições fixas de canal por content_type.
 * Quando definida, substitui QUALQUER descrição gerada pela IA para aquele tipo.
 * Ideal para canais com identidade/comunidade estabelecida.
 */
const FIXED_DESCRIPTIONS = {
  'batalha-de-rima': `CLUBE DO URSO
https://chat.whatsapp.com/JRHBWKytMqF0rzKlZ6Jg72?mode=wwt

Aqui não é só rima… é guerra de palavras. ⚔️🔥

Cada verso é um golpe, cada punchline é um ataque direto. Nas batalhas de rima, não existe roteiro — só mente afiada, coração acelerado e a coragem de encarar o adversário frente a frente.

Aqui você vai ver MCs transformando pensamento em munição, criatividade em escudo e atitude em vitória. É improviso, é pressão, é emoção no limite. Quem vacila, cai. Quem domina, faz história.

Se você sente a energia do duelo, o peso da resposta na hora certa e a vibração da plateia explodindo a cada rima… então esse é o seu lugar.

💥 Se inscreve no canal
💥 Ativa o sino
💥 E vem viver cada batalha como se fosse a última

Porque aqui… só os mais fortes sobrevivem no mic. 🎤🔥
#BatalhaDeRima #Freestyle #HipHop #DueloDeMCs #RapNacional`,
};

const CATEGORY_TEMPLATES = {
  highlight: {
    titlePrefix: '',
    descIcon: '🏆',
    extraTags: '#Highlights #Esports',
  },
  educational: {
    titlePrefix: '[Educacional] ',
    descIcon: '🎓',
    extraTags: '#Educational #Tips',
  },
  funny: {
    titlePrefix: '',
    descIcon: '😂',
    extraTags: '#Funny #Moments',
  },
};

/**
 * Gera título, descrição e tags YouTube otimizados,
 * baseados em clip_category, type e content_type.
 *
 * @param {object} suggestion - { title, reason, clip_category, type, suggested_tags, suggested_description, content_type }
 * @param {object|null} riotData
 * @returns {{ title: string, description: string, tags: string[] }}
 */
function generateYouTubeMetadata(suggestion, riotData) {
  const { title, reason, clip_category, type, suggested_tags, suggested_description, content_type } = suggestion;
  const typeTag = type === 'reel' ? '#Shorts' : '#Gaming';
  const tpl = CATEGORY_TEMPLATES[clip_category];

  // Tags: prioriza sugestão da IA, depois fallback por content_type
  const tags = Array.isArray(suggested_tags) && suggested_tags.length
    ? suggested_tags
    : (TAGS_BY_CONTENT_TYPE[content_type] || TAGS_BY_CONTENT_TYPE.mbl);

  // Bloco Riot API (opcional)
  let riotBlock = null;
  if (riotData) {
    const parts = [];
    if (riotData.champion) parts.push(`⚔️ ${riotData.champion}`);
    if (riotData.tier) parts.push(`${riotData.tier} ${riotData.rank} ${riotData.leaguePoints}LP`);
    if (parts.length) riotBlock = parts.join(' | ');
  }

  const finalTitle = tpl ? `${tpl.titlePrefix}${title}`.substring(0, 100) : (title || '');

  // Descrição fixa de canal: prioridade máxima — substitui tudo
  if (FIXED_DESCRIPTIONS[content_type]) {
    return { title: finalTitle, description: FIXED_DESCRIPTIONS[content_type], tags };
  }

  // Descrição: prioriza sugestão da IA
  if (suggested_description) {
    const descWithRiot = riotBlock
      ? `${suggested_description}\n\n${riotBlock}`
      : suggested_description;
    return { title: finalTitle, description: descWithRiot, tags };
  }

  if (!tpl) {
    // Default: sem categoria (outros content_types ou sem clip_category)
    const desc = [reason, riotBlock, `${LOL_HASHTAGS} ${typeTag}`]
      .filter(Boolean)
      .join('\n\n');
    return { title: finalTitle, description: desc, tags };
  }

  const descParts = [
    `${tpl.descIcon} ${title}`,
    reason || '',
    riotBlock,
    `${LOL_HASHTAGS} ${tpl.extraTags} ${typeTag}`,
  ].filter(Boolean);

  return {
    title: finalTitle,
    description: descParts.join('\n\n'),
    tags,
  };
}

module.exports = { generateYouTubeMetadata, TAGS_BY_CONTENT_TYPE };
