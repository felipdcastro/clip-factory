'use strict';

const OpenAI = require('openai');
const logger = require('../../utils/logger').child({ module: 'seo-copywriter' });

const CONTENT_TYPE_TONE = {
  'lol-esports':     'apaixonado por esports, usa termos do jogo em inglês naturalmente, emojis de fogo e espada',
  mbl:               'direto e assertivo, tom de debate político sério, sem emojis excessivos',
  toguro:            'hype de streaming, energético, emojis expressivos, linguagem da comunidade gamer',
  comedia:           'leve e divertido, cria expectativa do momento engraçado, emojis de risada',
  sinuca:            'entusiasmado mas respeitoso com o esporte, emojis de bola de sinuca',
  'batalha-de-rima': 'linguagem do nicho hip-hop, usa gírias do rap, emojis de microfone e fogo',
  'slap-battles':    'impactante e hype, reação exagerada, emojis de choque e explosão, viral',
};

const SYSTEM_PROMPT = `Você é um copywriter especializado em YouTube com histórico de títulos com CTR acima de 8%.

MISSÃO: Criar título e descrição que maximizem cliques e retenção.

REGRAS DE TÍTULO:
- Máximo 70 caracteres
- Keyword primária nas primeiras 3 palavras quando possível
- Uma palavra em MAIÚSCULAS para ênfase (máx 2 palavras)
- Crie urgência ou curiosidade sem clickbait vazio
- 1 emoji no final do título quando o tom pedir (máx 1)

REGRAS DE DESCRIÇÃO:
- Linha 1 (~100 chars): aparece no search — keyword + hook imediato
- Linhas 2-3: contexto breve com keyword secundária inserida naturalmente
- Linha 4: CTA claro e direto (ex: "Se inscreva para não perder os melhores momentos")
- Última linha: 3-5 hashtags relevantes (diferentes das tags do vídeo)
- Total: 250-400 caracteres

RETORNE SOMENTE JSON:
{
  "title": "...",
  "description": "..."
}`;

async function runSEOCopywriter({ contentType, clipTitle, clipReason, clipCategory, analystResult, videoTitle }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tone = CONTENT_TYPE_TONE[contentType] || 'engajante e natural';

  const userPrompt = `TOM DO CANAL: ${tone}

TÍTULO ORIGINAL DO CLIP: ${clipTitle}
CATEGORIA: ${clipCategory || 'highlight'}
MOMENTO: ${clipReason || ''}
VÍDEO ORIGINAL: ${videoTitle || ''}

ESTRATÉGIA DO ANALISTA:
- Keyword primária: ${analystResult.primaryKeyword}
- Keywords secundárias: ${(analystResult.secondaryKeywords || []).join(', ')}
- Estratégia: ${analystResult.strategy}

Crie o título e a descrição YouTube otimizados.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const result = JSON.parse(response.choices[0].message.content);
  logger.info({ original_title: clipTitle, seo_title: result.title }, 'SEO Copywriter concluído');
  return result;
}

module.exports = { runSEOCopywriter };
