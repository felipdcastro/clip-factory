const OpenAI = require('openai');

const SYSTEM_PROMPT = `Você é um especialista em criação de conteúdo para YouTube focado em política brasileira.
Seu trabalho é analisar transcrições de vídeos do MBL (Movimento Brasil Livre) e identificar os melhores momentos para cortes virais.

REGRAS:
- Sugira exatamente 5 a 8 clipes do tipo "video" (formato horizontal, 2 a 10 minutos cada)
- Sugira exatamente 5 a 8 clipes do tipo "reel" (formato vertical/shorts, 30 a 90 segundos cada)
- Priorize: declarações polêmicas, debates acalorados, momentos marcantes, frases de impacto
- Títulos devem ser chamativos e adequados para YouTube (máx 70 caracteres)
- O campo "reason" deve explicar por que aquele trecho é viral/relevante

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
}`;

/**
 * Formata a transcrição para envio ao GPT
 * Inclui timestamps para que o GPT possa referenciar os momentos
 */
function formatTranscriptionForPrompt(text, words, durationSeconds) {
  const minutes = Math.floor(durationSeconds / 60);

  // Cria marcadores de tempo a cada 30 segundos para orientar o GPT
  const timeMarkers = [];
  if (Array.isArray(words) && words.length > 0) {
    let currentMarker = 30;
    words.forEach(word => {
      const wordStart = word.start / 1000; // ms → s
      if (wordStart >= currentMarker) {
        timeMarkers.push(`[${currentMarker}s] `);
        currentMarker += 30;
      }
    });
  }

  return `DURAÇÃO TOTAL: ${minutes} minutos (${durationSeconds} segundos)

TRANSCRIÇÃO COMPLETA:
${text}`;
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

  console.log(`⚠️  Transcrição longa (${estimatedTokens} tokens) — dividida em 2 chunks`);
  return [
    { text: chunk1Text, words: chunk1Words },
    { text: chunk2Text, words: chunk2Words },
  ];
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
async function analyzeTranscription(transcriptionText, words, durationSeconds) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = chunkTranscription(transcriptionText, words || []);

  const allSuggestions = [];

  for (const chunk of chunks) {
    const userPrompt = formatTranscriptionForPrompt(chunk.text, chunk.words, durationSeconds);
    const promptTemplate = process.env.ANALYSIS_PROMPT_TEMPLATE || null;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: promptTemplate || SYSTEM_PROMPT },
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

    allSuggestions.push(...parsed.suggestions);
  }

  return deduplicateSuggestions(allSuggestions);
}

module.exports = { analyzeTranscription, estimateTokens };
