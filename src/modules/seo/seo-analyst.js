'use strict';

const OpenAI = require('openai');
const logger = require('../../utils/logger').child({ module: 'seo-analyst' });

let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const CONTENT_TYPE_CONTEXT = {
  'lol-esports':     'League of Legends esports — gamers e fãs de e-sports, 16-30 anos, alta competitividade no YouTube',
  mbl:               'Política brasileira (MBL) — adultos 25-50 anos, interesse em debate político e economia',
  toguro:            'Streamer Toguro — gamers e fãs de streaming, 15-25 anos, nicho com audiência fiel',
  comedia:           'Comédia brasileira — audiência ampla 18-40 anos, entretenimento e viral',
  sinuca:            'Sinuca brasileira — apreciadores de bilhar/snooker, 25-55 anos, nicho específico',
  'batalha-de-rima': 'Batalha de rima / rap nacional — fãs de hip-hop e freestyle, 16-35 anos',
  'slap-battles':    'Slap battles / batalha de tapa — fãs de esportes extremos e viral, 16-30 anos',
  'skills-desafios': 'Habilidades esportivas e desafios — fãs de esportes e viral, 14-35 anos, alto potencial de Shorts',
};

const SYSTEM_PROMPT = `Você é um especialista em SEO para YouTube com histórico comprovado de crescimento orgânico de canais.

Sua tarefa é criar a estratégia de palavras-chave ideal para um clip, maximizando visualizações orgânicas.

RETORNE SOMENTE JSON válido com esta estrutura:
{
  "primaryKeyword": "palavra-chave principal (1-3 palavras, alta busca)",
  "secondaryKeywords": ["kw2", "kw3", "kw4"],
  "tags": ["tag1", "tag2", ...],
  "seoScore": 75,
  "strategy": "explicação da estratégia em 1-2 frases"
}

REGRAS para tags (retorne 10-15 tags):
- 30% broad: alto volume de busca (ex: "League of Legends", "comédia brasileira")
- 50% niche: média competição (ex: "CBLOL highlights 2025", "slap battle KO")
- 20% long-tail: alta conversão (ex: "melhor pentakill da semana", "knockout slap battle viral")
- Inclua variações: singular/plural, com/sem acento, inglês/português quando relevante
- Máximo 30 caracteres por tag

CRITÉRIOS para seoScore (0-100):
- Potencial viral do momento (0-30)
- Nicho vs competição (0-30)
- Qualidade da keyword principal (0-20)
- Aderência da audiência ao conteúdo (0-20)`;

async function runSEOAnalyst({ contentType, clipTitle, clipReason, clipCategory, videoTitle }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');

  const client = getClient();
  const context = CONTENT_TYPE_CONTEXT[contentType] || 'Conteúdo brasileiro — audiência geral';

  const userPrompt = `NICHO E AUDIÊNCIA: ${context}

VÍDEO ORIGINAL: ${videoTitle || 'Não disponível'}
TÍTULO DO CLIP: ${clipTitle}
CATEGORIA: ${clipCategory || 'highlight'}
MOMENTO: ${clipReason || ''}

Crie a estratégia de SEO ideal para este clip.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  let result;
  try {
    result = JSON.parse(response.choices[0].message.content);
  } catch {
    throw new Error('SEO Analyst retornou JSON inválido');
  }
  logger.info({ clip_title: clipTitle, seo_score: result.seoScore }, 'SEO Analyst concluído');
  return result;
}

module.exports = { runSEOAnalyst };
