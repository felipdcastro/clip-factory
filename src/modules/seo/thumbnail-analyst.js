'use strict';

const OpenAI = require('openai');
const logger = require('../../utils/logger').child({ module: 'thumbnail-analyst' });

const SYSTEM_PROMPT = `Você é um estrategista de thumbnails do YouTube que identifica o frame mais impactante de um clip apenas pela transcrição.

O MELHOR FRAME para thumbnail:
- Captura o PICO de emoção: reação, virada, clímax, expressão extrema
- Acontece DURANTE ou logo APÓS a ação principal (reação > ação)
- Tem narração/exclamação de alta intensidade emocional naquele instante
- Para esportes/batalhas: impacto ou reação imediata da plateia/narrador
- Para gaming: kill/objetivo/pentakill ou grito dos casters
- Para comédia: punchline ou gargalhada da plateia
- Para política: frase de impacto ou expressão de choque

RETORNE SOMENTE JSON:
{
  "offsetSec": 23.5,
  "rationale": "1 frase: qual reação ou expressão você espera neste frame exato"
}

CRÍTICO: offsetSec é em SEGUNDOS A PARTIR DO INÍCIO DO CLIP (não do vídeo inteiro).
Valor deve estar entre 0 e a duração total do clip.`;

async function runThumbnailAnalyst({ words, clipStartSec, clipEndSec, contentType, clipReason }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const clipStartMs = clipStartSec * 1000;
  const clipEndMs   = clipEndSec * 1000;
  const clipDuration = clipEndSec - clipStartSec;

  // Texto com timestamps relativos ao início do clip, marcador a cada 5s
  const clipWords = Array.isArray(words)
    ? words.filter(w => w.start >= clipStartMs && w.end <= clipEndMs)
    : [];

  let timedText = '';
  let lastMarker = -5;
  for (const w of clipWords) {
    const tSec = (w.start - clipStartMs) / 1000;
    if (tSec - lastMarker >= 5) {
      timedText += `\n[${tSec.toFixed(1)}s] `;
      lastMarker = Math.floor(tSec / 5) * 5;
    }
    timedText += w.text + ' ';
  }

  const userPrompt = `TIPO DE CONTEÚDO: ${contentType}
DURAÇÃO DO CLIP: ${Math.round(clipDuration)}s
MOMENTO IDENTIFICADO: ${clipReason || ''}

TRANSCRIÇÃO (timestamps a partir do início do clip):
${timedText.trim() || 'Transcrição não disponível'}

Identifique o segundo ideal para o frame de thumbnail.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = JSON.parse(response.choices[0].message.content);
  const offsetSec = Math.min(Math.max(0, parseFloat(raw.offsetSec) || 0), clipDuration - 0.5);

  logger.info({ offset_sec: offsetSec, rationale: raw.rationale }, 'Thumbnail Analyst concluído');
  return { offsetSec, rationale: raw.rationale || '' };
}

module.exports = { runThumbnailAnalyst };
