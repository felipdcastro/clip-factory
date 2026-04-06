'use strict';

// Mock OpenAI SDK
const mockCreate = jest.fn();

jest.mock('openai', () => {
  const OpenAI = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return OpenAI;
});

const { analyzeTranscription, estimateTokens } = require('./openai.service');

describe('estimateTokens', () => {
  it('estima ~1 token por 4 caracteres', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('abc')).toBe(1);
  });
});

describe('analyzeTranscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  it('lança se OPENAI_API_KEY não configurada', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(analyzeTranscription('texto', [], 600)).rejects.toThrow('OPENAI_API_KEY não configurada');
  });

  it('retorna sugestões válidas da API', async () => {
    const suggestions = [
      { start_time: 10, end_time: 370, title: 'Vídeo', reason: 'Bom', type: 'video' },
      { start_time: 50, end_time: 110, title: 'Reel', reason: 'Viral', type: 'reel' },
    ];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ suggestions }) } }],
    });

    const result = await analyzeTranscription('Texto de teste', [], 600);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('video');
  });

  it('lança se GPT retorna JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'não é json' } }],
    });
    await expect(analyzeTranscription('texto', [], 600)).rejects.toThrow('JSON inválido');
  });

  it('lança se resposta não contém array suggestions', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ resultado: [] }) } }],
    });
    await expect(analyzeTranscription('texto', [], 600)).rejects.toThrow('"suggestions"');
  });

  it('deduplicata sugestões com start_time similar', async () => {
    const suggestions = [
      { start_time: 10, end_time: 370, title: 'Video 1', reason: 'A', type: 'video' },
      { start_time: 12, end_time: 375, title: 'Video 2', reason: 'B', type: 'video' }, // duplicata (±5s)
      { start_time: 50, end_time: 110, title: 'Reel', reason: 'C', type: 'reel' },
    ];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ suggestions }) } }],
    });

    const result = await analyzeTranscription('texto', [], 600);
    expect(result).toHaveLength(2); // video 2 é removida por ser duplicata
  });

  it('formata texto sem words (usa texto puro)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ suggestions: [{ start_time: 0, end_time: 370, title: 'T', reason: 'R', type: 'video' }] }) } }],
    });
    const result = await analyzeTranscription('Texto sem palavras', null, 600);
    expect(mockCreate).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('formata texto com words e markers de tempo', async () => {
    const words = Array.from({ length: 5 }, (_, i) => ({
      text: `palavra${i}`,
      start: i * 10000, // 0, 10s, 20s, 30s, 40s
      end: (i + 1) * 10000,
      confidence: 0.99,
    }));
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ suggestions: [] }) } }],
    });

    await analyzeTranscription('Texto longo', words, 600);
    const callArgs = mockCreate.mock.calls[0][0];
    // O userPrompt deve conter o texto com marcadores de tempo
    expect(callArgs.messages[1].content).toContain('[0s]');
  });
});
