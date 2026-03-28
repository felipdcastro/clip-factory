'use strict';

const LOL_HASHTAGS = '#LoL #LeagueOfLegends';

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
 * Gera título e descrição YouTube otimizados para um clip de LoL,
 * baseados em clip_category e type (video/reel).
 *
 * @param {object} suggestion - { title, reason, clip_category, type }
 * @returns {{ title: string, description: string }}
 */
function generateYouTubeMetadata(suggestion, riotData) {
  const { title, reason, clip_category, type } = suggestion;
  const typeTag = type === 'reel' ? '#Shorts' : '#Gaming';
  const tpl = CATEGORY_TEMPLATES[clip_category];

  // Bloco Riot API (opcional)
  let riotBlock = null;
  if (riotData) {
    const parts = [];
    if (riotData.champion) parts.push(`⚔️ ${riotData.champion}`);
    if (riotData.tier) parts.push(`${riotData.tier} ${riotData.rank} ${riotData.leaguePoints}LP`);
    if (parts.length) riotBlock = parts.join(' | ');
  }

  if (!tpl) {
    // Default: sem categoria (outros content_types ou sem clip_category)
    const desc = [reason, riotBlock, `${LOL_HASHTAGS} ${typeTag}`]
      .filter(Boolean)
      .join('\n\n');
    return { title: title || '', description: desc };
  }

  const generatedTitle = `${tpl.titlePrefix}${title}`.substring(0, 100);
  const descParts = [
    `${tpl.descIcon} ${title}`,
    reason || '',
    riotBlock,
    `${LOL_HASHTAGS} ${tpl.extraTags} ${typeTag}`,
  ].filter(Boolean);

  return {
    title: generatedTitle,
    description: descParts.join('\n\n'),
  };
}

module.exports = { generateYouTubeMetadata };
