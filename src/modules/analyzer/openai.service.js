const OpenAI = require('openai');
const logger = require('../../utils/logger').child({ module: 'openai' });

const VALID_CLIP_CATEGORIES = ['highlight', 'educational', 'funny'];

const PROMPTS = {
  'lol-esports': `Você é um especialista em criação de conteúdo viral para YouTube focado em League of Legends e-sports.
Seu trabalho é analisar transcrições de narrações de casters de partidas profissionais (LCK, LEC, LCS, CBLOL, Worlds) e identificar os melhores momentos para cortes.

SINAL PRIMÁRIO: Picos de excitação dos casters são o indicador mais confiável de momento importante.
Detecte expressões como: "OH MY GOD", "PENTAKILL", "THE BARON STEAL", "WHAT A PLAY", "INCREDIBLE", "INSANE", "OH WOW", "FAKER", "THE PLAY", "TEAMFIGHT", "ACE", "CLUTCH", variações em português/coreano legendado, e qualquer aumento de intensidade vocal.

CATEGORIAS DE CLIPES:
- "highlight": pentakills, teamfights decisivos, baron/dragon steals, outplays individuais, clutch plays, aces, nexus rushes
- "educational": demonstrações de mecânica de campeão, rotações táticas, wave management, jungle pathing, posicionamento
- "funny": tilt visível de jogadores, plays completamente inesperados, interações engraçadas entre casters, misplays épicos, reações exageradas

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 5 a 8 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 3 minutos e MÁXIMO 10 minutos cada)
- Inclua contexto antes do momento + o momento + a resolução — não corte no meio de um teamfight
- Priorize: teamfights completos, sequências de objetivos, momentos que mudaram o jogo
- Título no padrão e-sports: "Faker Azir Pentakill — LCK Spring 2025" ou "T1 Baron Steal com 20% HP" (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 5 a 8 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- O reel deve ser auto-contido — o momento específico sem contexto extenso
- Priorize: o instante exato do pentakill/steal/outplay + reação dos casters
- Título direto: "Faker PENTA 🔥", "Baron Steal INSANO", "O Outplay do Século" (máx 70 caracteres)

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 1245.0,
      "end_time": 1820.0,
      "title": "Faker Azir Pentakill — LCK Spring 2025",
      "reason": "Casters explodiram com OH MY GOD PENTAKILL — sequência épica de teamfight com 5 kills em 8 segundos",
      "clip_category": "highlight",
      "type": "video"
    },
    {
      "start_time": 1380.0,
      "end_time": 1435.0,
      "title": "Faker PENTA",
      "reason": "O instante exato do pentakill com reação máxima dos casters — auto-contido e viral",
      "clip_category": "highlight",
      "type": "reel"
    },
    {
      "start_time": 2100.0,
      "end_time": 2280.0,
      "title": "Como T1 Fez o Baron Steal Perfeito",
      "reason": "Caster explica o jungle smite timing enquanto acontece — ótimo conteúdo educacional",
      "clip_category": "educational",
      "type": "reel"
    }
  ]
}`,

  mbl: `Você é um especialista em criação de conteúdo para YouTube focado em política brasileira.
Seu trabalho é analisar transcrições de vídeos do MBL (Movimento Brasil Livre) e identificar os melhores momentos para cortes virais.

REGRAS:
- Sugira exatamente 5 a 8 clipes do tipo "video" (formato horizontal, MÍNIMO 5 minutos e MÁXIMO 10 minutos cada)
- Sugira exatamente 5 a 8 clipes do tipo "reel" (formato vertical/shorts, MÍNIMO 45 segundos e MÁXIMO 60 segundos cada)
- Priorize: declarações polêmicas, debates acalorados, momentos marcantes, frases de impacto
- Títulos devem ser chamativos e adequados para YouTube (máx 70 caracteres)
- O campo "reason" deve explicar por que aquele trecho é viral/relevante
OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 125.4,
      "end_time": 305.8,
      "title": "Kim Kataguiri detona reforma tributária no congresso",
      "reason": "Discurso inflamado com dados concretos sobre aumento de impostos",
      "type": "video"
    },
    {
      "start_time": 200.0,
      "end_time": 245.0,
      "title": "MBL: 'Isso é confisco!'",
      "reason": "Frase de impacto de 45 segundos perfeita para Shorts",
      "type": "reel"
    }
  ]
}`,

  toguro: `Você é um especialista em criação de conteúdo viral para YouTube focado no streamer/youtuber Toguro.
Seu trabalho é analisar transcrições de lives e vídeos do Toguro e identificar os melhores momentos para cortes virais.

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 5 a 10 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 3 minutos e MÁXIMO 12 minutos cada)
- Priorize: melhores momentos de live, histórias engraçadas, discussões quentes, highlights de gameplay épicos, reações intensas
- Cada clipe deve ter começo, meio e fim — não corte no meio de uma situação
- Título chamativo estilo YouTube (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 5 a 10 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- Priorize: frases icônicas do Toguro, reações exageradas, punchlines engraçadas, momentos de raiva/alegria intensa, jogadas insanas, interações com a chat
- O reel deve ser auto-contido — quem assiste entende sem contexto

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 300.0,
      "end_time": 780.0,
      "title": "Toguro EXPLODE ao perder partida impossível 😤",
      "reason": "Sequência épica de rage que gerou memes — envolve chat, gameplay e reação",
      "type": "video"
    },
    {
      "start_time": 512.0,
      "end_time": 572.0,
      "title": "Toguro: 'Isso é IMPOSSÍVEL!' 💀",
      "reason": "Frase icônica com reação exagerada — perfeita para Shorts viral",
      "type": "reel"
    }
  ]
}`,

  comedia: `Você é um especialista em criação de conteúdo viral para YouTube focado em vídeos de comédia brasileira.
Seu trabalho é analisar transcrições de stand-up, esquetes, podcasts de humor, vídeos engraçados e identificar os melhores momentos para cortes virais.

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 5 a 10 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 3 minutos e MÁXIMO 12 minutos cada)
- Priorize: bits de stand-up completos, histórias engraçadas do início ao fim, debates hilários, esquetes completas, roasts intensos
- Cada clipe deve ter começo, meio e fim — não corte no meio de uma piada ou história
- Título chamativo estilo YouTube (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 5 a 10 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- Priorize: punchlines memoráveis, reações exageradas, momentos de gargalhada da plateia, frases icônicas, confusões engraçadas, auto-depreciação cômica
- O reel deve ser auto-contido — quem assiste entende sem contexto

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 120.0,
      "end_time": 480.0,
      "title": "A história mais engraçada que você vai ouvir hoje 😂",
      "reason": "Bit completo com setup, desenvolvimento e punchline devastadora — plateia no chão",
      "type": "video"
    },
    {
      "start_time": 305.0,
      "end_time": 365.0,
      "title": "Isso aconteceu de VERDADE?! 💀",
      "reason": "Punchline inesperada com reação da plateia — momento perfeito para Shorts viral",
      "type": "reel"
    }
  ]
}`,

  'batalha-de-rima': `Você é um especialista em criação de conteúdo para YouTube focado em batalhas de rima brasileiras.
Seu trabalho é analisar transcrições de batalhas de rima e identificar: (1) a batalha completa de cada dupla e (2) os melhores momentos para reels.

REGRAS PARA "video" (batalha completa por dupla):
- Identifique CADA dupla que batalhou e corte a batalha completa dela (do início ao fim, incluindo todas as rondas)
- Duração: MÍNIMO 3 minutos e MÁXIMO 20 minutos por dupla
- Formato horizontal (16:9)
- Título: "Nome do MC1 vs Nome do MC2 | Nome do Evento" (máx 70 caracteres)
- IMPORTANTE: cubra TODAS as duplas do vídeo, não apenas as melhores

REGRAS PARA "reel" (melhores momentos):
- Extraia os melhores punchlines, trocas quentes e reações da plateia
- Duração: MÍNIMO 30 segundos e MÁXIMO 90 segundos cada (NUNCA ultrapasse 90s)
- Formato vertical (9:16) — ideal para Instagram Reels e YouTube Shorts
- Priorize: punchlines que geraram reação, trocas diretas entre os MCs, momentos de virada
- Sugira 2 a 4 reels por dupla

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 60.0,
      "end_time": 780.0,
      "title": "MC Alpha vs MC Beta | Batalha do Conhecimento",
      "reason": "Batalha completa da dupla — 3 rondas intensas com reação forte da plateia",
      "type": "video"
    },
    {
      "start_time": 320.0,
      "end_time": 395.0,
      "title": "MC Alpha DESTRUIU com esse punchline 🔥",
      "reason": "Punchline que parou a batalha — plateia explodiu, adversário sem resposta",
      "type": "reel"
    }
  ]
}`,
};

function getSystemPrompt(contentType) {
  if (process.env.ANALYSIS_PROMPT_TEMPLATE) {
    return process.env.ANALYSIS_PROMPT_TEMPLATE;
  }
  const ct = contentType || process.env.CONTENT_TYPE || 'mbl';
  const prompt = PROMPTS[ct];
  if (!prompt) {
    logger.warn({ content_type: ct }, `content_type desconhecido — usando prompt padrão (mbl)`);
    return PROMPTS.mbl;
  }
  return prompt;
}

/**
 * Formata a transcrição para envio ao GPT
 * Inclui timestamps para que o GPT possa referenciar os momentos
 */
function formatTranscriptionForPrompt(text, words, durationSeconds) {
  const minutes = Math.floor(durationSeconds / 60);

  // Intercala marcadores de tempo [Xm Ys] a cada 30 segundos no texto
  let timedText = '';
  if (Array.isArray(words) && words.length > 0) {
    let nextMarkerSec = 0;
    words.forEach(word => {
      const wordStartSec = word.start / 1000;
      if (wordStartSec >= nextMarkerSec) {
        const m = Math.floor(nextMarkerSec / 60);
        const s = Math.floor(nextMarkerSec % 60);
        timedText += `\n[${m}m${String(s).padStart(2,'0')}s] `;
        nextMarkerSec += 30;
      }
      timedText += word.text + ' ';
    });
  } else {
    timedText = text;
  }

  return `DURAÇÃO TOTAL: ${minutes} minutos (${durationSeconds} segundos)

IMPORTANTE: Os marcadores [Xm Ys] indicam o timestamp exato no vídeo. Use esses valores para definir start_time e end_time em segundos.

TRANSCRIÇÃO COM TIMESTAMPS:
${timedText.trim()}`;
}

/**
 * Estima número de tokens (1 token ≈ 4 caracteres)
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Divide texto em chunks com overlap se necessário
 */
function chunkTranscription(text, words, maxTokens = 80000) {
  const estimatedTokens = estimateTokens(text);

  if (estimatedTokens <= maxTokens) {
    return [{ text, words }];
  }

  // Divide em 2 chunks com overlap de ~2 minutos (≈500 palavras)
  const midPoint = Math.floor(words.length / 2);
  const overlapStart = Math.max(0, midPoint - 100);

  const chunk1Words = words.slice(0, midPoint + 100);
  const chunk2Words = words.slice(overlapStart);

  const chunk1Text = chunk1Words.map(w => w.text).join(' ');
  const chunk2Text = chunk2Words.map(w => w.text).join(' ');

  logger.warn({ estimated_tokens: estimatedTokens }, `Transcrição longa — dividida em 2 chunks`);
  return [
    { text: chunk1Text, words: chunk1Words },
    { text: chunk2Text, words: chunk2Words },
  ];
}

/**
 * Valida que um item do GPT possui os campos obrigatórios com tipos corretos.
 * Rejeita silenciosamente itens malformados em vez de deixar o pipeline quebrar.
 */
function validateSuggestionSchema(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.start_time !== 'number' || !Number.isFinite(s.start_time)) return false;
  if (typeof s.end_time !== 'number' || !Number.isFinite(s.end_time)) return false;
  if (typeof s.title !== 'string' || !s.title.trim()) return false;
  if (typeof s.reason !== 'string') return false;
  if (!['video', 'reel'].includes(s.type)) return false;
  return true;
}

/**
 * Remove sugestões duplicadas (mesmo start_time ±5s)
 */
function deduplicateSuggestions(suggestions) {
  const seen = [];
  return suggestions.filter(s => {
    const isDuplicate = seen.some(
      existing => Math.abs(existing.start_time - s.start_time) < 5 && existing.type === s.type
    );
    if (!isDuplicate) seen.push(s);
    return !isDuplicate;
  });
}

/**
 * Analisa transcrição e retorna sugestões de cortes
 */
async function analyzeTranscription(transcriptionText, words, durationSeconds, contentType) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = chunkTranscription(transcriptionText, words || []);

  const allSuggestions = [];

  for (const chunk of chunks) {
    const userPrompt = formatTranscriptionForPrompt(chunk.text, chunk.words, durationSeconds);
    const systemPrompt = getSystemPrompt(contentType);

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = response.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('GPT retornou JSON inválido');
    }

    if (!Array.isArray(parsed.suggestions)) {
      throw new Error('Resposta do GPT não contém array "suggestions"');
    }

    const validItems = parsed.suggestions.filter(validateSuggestionSchema);
    const dropped = parsed.suggestions.length - validItems.length;
    if (dropped > 0) {
      logger.warn({ dropped, chunk_index: chunks.indexOf(chunk) }, 'GPT retornou itens com schema inválido — descartados');
    }

    allSuggestions.push(...validItems);
  }

  return deduplicateSuggestions(allSuggestions);
}

module.exports = { analyzeTranscription, estimateTokens, VALID_CLIP_CATEGORIES };
