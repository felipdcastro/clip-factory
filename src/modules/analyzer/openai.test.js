'use strict';

// Mock OpenAI SDK
const mockCreate = jest.fn();

jest.mock('openai', () => {
  const OpenAI = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return OpenAI;
});

const { analyzeTranscription, calcClipsPerType, chunkByTime } = require('./openai.service');

describe('calcClipsPerType', () => {
  it('retorna mínimo 5 para vídeos curtos', () => {
    expect(calcClipsPerType(300)).toBe(5);
    expect(calcClipsPerType(0)).toBe(5);
  });
  it('escala com a duração', () => {
    expect(calcClipsPerType(60 * 60)).toBeGreaterThan(5); // 60min → >5
    expect(calcClipsPerType(120 * 60)).toBeGreaterThan(10); // 120min → >10
  });
  it('não ultrapassa 25', () => {
    expect(calcClipsPerType(999 * 60)).toBe(25);
  });
});

describe('chunkByTime', () => {
  it('retorna array vazio para words vazio', () => {
    expect(chunkByTime([])).toEqual([]);
  });
  it('retorna 1 chunk para vídeo de 10 min', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`, start: i * 6000, end: i * 6000 + 500,
    })); // 100 palavras, cada 6s → ~10min
    const chunks = chunkByTime(words);
    expect(chunks.length).toBe(1);
  });
  it('retorna múltiplos chunks para vídeo de 60 min', () => {
    const words = Array.from({ length: 600 }, (_, i) => ({
      text: `w${i}`, start: i * 6000, end: i * 6000 + 500,
    })); // 600 palavras, cada 6s → 60min
    const chunks = chunkByTime(words);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
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
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].type).toBe('video');
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
    expect(result.suggestions).toHaveLength(2); // video 2 é removida por ser duplicata
  });

  it('formata texto sem words (usa texto puro)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ suggestions: [{ start_time: 0, end_time: 370, title: 'T', reason: 'R', type: 'video' }] }) } }],
    });
    const result = await analyzeTranscription('Texto sem palavras', null, 600);
    expect(mockCreate).toHaveBeenCalled();
    expect(result.suggestions).toHaveLength(1);
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
