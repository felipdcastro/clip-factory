// Mocks antes de qualquer require
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('./audio-extractor', () => ({
  extractAudio: jest.fn().mockResolvedValue('/tmp/job_1_audio.wav'),
  cleanupAudio: jest.fn(),
}));

jest.mock('./assemblyai.service', () => ({
  transcribeAudio: jest.fn().mockResolvedValue({
    text: 'Reforma tributária é um absurdo total.',
    words: [
      { text: 'Reforma', start: 0, end: 700, confidence: 0.99 },
      { text: 'tributária', start: 750, end: 1400, confidence: 0.98 },
    ],
    audio_duration: 120,
  }),
}));

const { query } = require('../../db/connection');
const { processTranscription, getTranscription } = require('./transcription.service');

describe('processTranscription', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falha se job não está no status downloaded', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending', file_path: null }] });
    await expect(processTranscription(1)).rejects.toThrow("status 'downloaded'");
  });

  it('falha se job não tem file_path', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'downloaded', file_path: null }] });
    await expect(processTranscription(1)).rejects.toThrow('não tem arquivo de vídeo');
  });

  it('executa pipeline completo com sucesso', async () => {
    // job com status downloaded e file_path
    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'downloaded', file_path: '/tmp/job_1_video.mp4', duration_seconds: 120 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE status transcribing
      .mockResolvedValueOnce({ rows: [] }) // INSERT transcription
      .mockResolvedValueOnce({ rows: [] }); // UPDATE status transcribed

    const result = await processTranscription(1);
    expect(result.text).toBe('Reforma tributária é um absurdo total.');
    expect(result.words).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(4);
  });
});

describe('getTranscription', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna null se não encontrado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getTranscription(999);
    expect(result).toBeNull();
  });

  it('retorna transcrição existente', async () => {
    const mock = { id: 1, job_id: 1, text: 'Texto teste', words: '[]' };
    query.mockResolvedValueOnce({ rows: [mock] });
    const result = await getTranscription(1);
    expect(result.text).toBe('Texto teste');
  });
});
