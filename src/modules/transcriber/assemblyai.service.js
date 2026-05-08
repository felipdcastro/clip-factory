const { AssemblyAI } = require('assemblyai');

const ASSEMBLYAI_TIMEOUT_MS = parseInt(process.env.ASSEMBLYAI_TIMEOUT_MS || '600000'); // 10 min

/**
 * Transcreve um arquivo de áudio usando AssemblyAI
 * Retorna o texto completo e palavras com timestamps
 */
async function transcribeAudio(audioPath, languageCode) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY não configurada');
  }

  const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
  const langCode = languageCode || process.env.TRANSCRIPTION_LANGUAGE || 'pt';

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`AssemblyAI timeout após ${ASSEMBLYAI_TIMEOUT_MS / 1000}s`)), ASSEMBLYAI_TIMEOUT_MS)
  );

  const transcript = await Promise.race([
    client.transcripts.transcribe({
      audio: audioPath,
      language_code: langCode,
      speech_models: ['universal-2'],
    }),
    timeoutPromise,
  ]);

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI erro: ${transcript.error}`);
  }

  return {
    text: transcript.text,
    words: transcript.words, // [{ text, start, end, confidence }]
    audio_duration: transcript.audio_duration,
  };
}

module.exports = { transcribeAudio };
