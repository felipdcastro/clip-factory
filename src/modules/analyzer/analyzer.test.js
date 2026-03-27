jest.mock('../../db/connection', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('./openai.service', () => ({
  analyzeTranscription: jest.fn(),
  estimateTokens: jest.requireActual('./openai.service').estimateTokens,
  VALID_CLIP_CATEGORIES: jest.requireActual('./openai.service').VALID_CLIP_CATEGORIES,
}));

const { query } = require('../../db/connection');
const { analyzeTranscription } = require('./openai.service');
const { processAnalysis, updateSuggestionStatus, validateSuggestion } = require('./analyzer.service');

describe('validateSuggestion', () => {
  // video requer duração entre 5-10 min (300-600s); reel entre 45-60s
  const base = { start_time: 10, end_time: 370, title: 'Título teste', reason: 'Motivo', type: 'video' };

  it('aceita sugestão válida de vídeo', () => {
    expect(validateSuggestion(base, 3600)).toBe(true);
  });

  it('aceita reel válido (45-60s)', () => {
    expect(validateSuggestion({ ...base, start_time: 10, end_time: 65, type: 'reel' }, 3600)).toBe(true);
  });

  it('rejeita clip muito curto (< 300s para video)', () => {
    expect(validateSuggestion({ ...base, end_time: 25 }, 3600)).toBe(false);
  });

  it('rejeita vídeo muito longo (> 10min)', () => {
    expect(validateSuggestion({ ...base, end_time: 700 }, 3600)).toBe(false);
  });

  it('rejeita reel muito longo (> 90s)', () => {
    expect(validateSuggestion({ ...base, end_time: 110, type: 'reel' }, 3600)).toBe(false);
  });

  it('rejeita start_time negativo', () => {
    expect(validateSuggestion({ ...base, start_time: -1 }, 3600)).toBe(false);
  });

  it('rejeita tipo inválido', () => {
    expect(validateSuggestion({ ...base, type: 'short' }, 3600)).toBe(false);
  });

  it('rejeita end_time além da duração do job', () => {
    expect(validateSuggestion({ ...base, end_time: 5000 }, 3600)).toBe(false);
  });
});

describe('validateSuggestion — lol-esports', () => {
  const lolBase = { start_time: 0, end_time: 300, title: 'Faker Penta', reason: 'Epic', type: 'video' };

  it('aceita video lol-esports válido (300s = 5 min)', () => {
    expect(validateSuggestion(lolBase, 7200, 'lol-esports')).toBe(true);
  });

  it('rejeita video lol-esports curto (120s < 180s min)', () => {
    expect(validateSuggestion({ ...lolBase, end_time: 120 }, 7200, 'lol-esports')).toBe(false);
  });

  it('aceita reel lol-esports válido (60s)', () => {
    expect(validateSuggestion({ ...lolBase, end_time: 60, type: 'reel' }, 7200, 'lol-esports')).toBe(true);
  });

  it('rejeita reel lol-esports curto (25s < 30s min)', () => {
    expect(validateSuggestion({ ...lolBase, end_time: 25, type: 'reel' }, 7200, 'lol-esports')).toBe(false);
  });

  it('aceita sugestão com clip_category válido', () => {
    expect(validateSuggestion({ ...lolBase, clip_category: 'highlight' }, 7200, 'lol-esports')).toBe(true);
    expect(validateSuggestion({ ...lolBase, clip_category: 'educational' }, 7200, 'lol-esports')).toBe(true);
    expect(validateSuggestion({ ...lolBase, clip_category: 'funny' }, 7200, 'lol-esports')).toBe(true);
  });

  it('rejeita sugestão com clip_category inválido', () => {
    expect(validateSuggestion({ ...lolBase, clip_category: 'invalid' }, 7200, 'lol-esports')).toBe(false);
    expect(validateSuggestion({ ...lolBase, clip_category: '' }, 7200, 'lol-esports')).toBe(false);
  });

  it('aceita sugestão sem clip_category (backwards compat)', () => {
    expect(validateSuggestion(lolBase, 7200, 'lol-esports')).toBe(true);
  });
});

describe('processAnalysis — lol-esports clip_category serialization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefixa reason com [CATEGORY: X] quando clip_category presente', async () => {
    const mockSuggestions = [
      { start_time: 0, end_time: 300, title: 'Faker Penta', reason: 'Epic penta', clip_category: 'highlight', type: 'video' },
    ];

    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'transcribed', duration_seconds: 3600, content_type: 'lol-esports' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, job_id: 1, text: 'texto', words: '[]' }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE analyzing
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE analyzed

    analyzeTranscription.mockResolvedValueOnce(mockSuggestions);

    await processAnalysis(1);

    const insertCall = query.mock.calls[3];
    expect(insertCall[1][4]).toBe('[CATEGORY: highlight] Epic penta');
  });

  it('não altera reason quando clip_category ausente', async () => {
    const mockSuggestions = [
      { start_time: 0, end_time: 300, title: 'Clip genérico', reason: 'Motivo normal', type: 'video' },
    ];

    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'transcribed', duration_seconds: 3600, content_type: 'lol-esports' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, job_id: 1, text: 'texto', words: '[]' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    analyzeTranscription.mockResolvedValueOnce(mockSuggestions);

    await processAnalysis(1);

    const insertCall = query.mock.calls[3];
    expect(insertCall[1][4]).toBe('Motivo normal');
  });
});

describe('processAnalysis', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falha se job não está no status transcribed', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'downloaded' }] });
    await expect(processAnalysis(1)).rejects.toThrow("status 'transcribed'");
  });

  it('falha se não há transcrição', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'transcribed', duration_seconds: 300 }] })
      .mockResolvedValueOnce({ rows: [] }); // sem transcrição
    await expect(processAnalysis(1)).rejects.toThrow('não tem transcrição');
  });

  it('salva sugestões válidas e atualiza status para analyzed', async () => {
    const mockSuggestions = [
      { start_time: 10, end_time: 370, title: 'Vídeo teste', reason: 'Bom', type: 'video' },  // 360s = 6 min ✓
      { start_time: 50, end_time: 110, title: 'Reel teste', reason: 'Viral', type: 'reel' },   // 60s = max reel ✓
    ];

    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'transcribed', duration_seconds: 600 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, job_id: 1, text: 'texto teste', words: '[]' }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE analyzing
      .mockResolvedValueOnce({ rows: [] }) // INSERT suggestion 1
      .mockResolvedValueOnce({ rows: [] }) // INSERT suggestion 2
      .mockResolvedValueOnce({ rows: [] }); // UPDATE analyzed

    analyzeTranscription.mockResolvedValueOnce(mockSuggestions);

    const result = await processAnalysis(1);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('video');
    expect(result[1].type).toBe('reel');
  });
});

describe('updateSuggestionStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejeita status inválido', async () => {
    await expect(updateSuggestionStatus(1, 'invalido')).rejects.toThrow('Status inválido');
  });

  it('retorna sugestão atualizada', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'approved' }] });
    const result = await updateSuggestionStatus(1, 'approved');
    expect(result.status).toBe('approved');
  });

  it('lança 404 se sugestão não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(updateSuggestionStatus(999, 'approved')).rejects.toThrow('não encontrada');
  });
});
