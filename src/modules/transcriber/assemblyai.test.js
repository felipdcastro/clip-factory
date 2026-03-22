'use strict';

// Mock AssemblyAI SDK
const mockTranscribe = jest.fn().mockResolvedValue({
  status: 'completed',
  text: 'Reforma tributária é um absurdo total.',
  words: [{ text: 'Reforma', start: 0, end: 700, confidence: 0.99 }],
  audio_duration: 120,
});

jest.mock('assemblyai', () => ({
  AssemblyAI: jest.fn().mockImplementation(() => ({
    transcripts: { transcribe: mockTranscribe },
  })),
}));

const { transcribeAudio } = require('./assemblyai.service');

describe('transcribeAudio', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lança se ASSEMBLYAI_API_KEY não configurada', async () => {
    const orig = process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_API_KEY;
    await expect(transcribeAudio('/tmp/audio.wav')).rejects.toThrow('ASSEMBLYAI_API_KEY não configurada');
    if (orig) process.env.ASSEMBLYAI_API_KEY = orig;
  });

  it('transcreve áudio e retorna texto + palavras', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'test-api-key';
    const result = await transcribeAudio('/tmp/audio.wav');
    expect(result.text).toBe('Reforma tributária é um absurdo total.');
    expect(result.words).toHaveLength(1);
    expect(result.audio_duration).toBe(120);
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ audio: '/tmp/audio.wav' })
    );
  });

  it('lança se transcript status é error', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'test-api-key';
    mockTranscribe.mockResolvedValueOnce({ status: 'error', error: 'Áudio inválido' });
    await expect(transcribeAudio('/tmp/bad.wav')).rejects.toThrow('AssemblyAI erro: Áudio inválido');
  });

  it('usa TRANSCRIPTION_LANGUAGE do ambiente', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'test-api-key';
    process.env.TRANSCRIPTION_LANGUAGE = 'en';
    await transcribeAudio('/tmp/audio.wav');
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ language_code: 'en' })
    );
    delete process.env.TRANSCRIPTION_LANGUAGE;
  });
});
