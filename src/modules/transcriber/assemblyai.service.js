const { AssemblyAI } = require('assemblyai');

const POLITICAL_WORD_BOOST = [
  'MBL', 'Movimento Brasil Livre', 'Kim Kataguiri', 'Arthur do Val',
  'reforma tributária', 'impeachment', 'STF', 'Supremo Tribunal Federal',
  'congresso', 'senado', 'câmara', 'deputado', 'senador', 'presidente',
  'bolsonaro', 'lula', 'PT', 'PL', 'PSOL', 'PSDB', 'MDB',
  'privatização', 'estatização', 'neoliberal', 'socialismo',
  'pautar', 'votar', 'aprovado', 'rejeitado', 'sessão', 'plenário',
];

/**
 * Transcreve um arquivo de áudio usando AssemblyAI
 * Retorna o texto completo e palavras com timestamps
 */
async function transcribeAudio(audioPath) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY não configurada');
  }

  const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

  const transcript = await client.transcripts.transcribe({
    audio: audioPath,
    language_code: process.env.TRANSCRIPTION_LANGUAGE || 'pt',
    speech_model: 'universal-2',
  });

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
