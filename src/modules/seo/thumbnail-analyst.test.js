'use strict';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

beforeEach(() => {
  jest.resetModules();
  mockCreate.mockReset();
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

function makeResponse(content) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

// clipDuration = 15 - 5 = 10s
const BASE_INPUT = {
  words: [
    { start: 5000, end: 5500, text: 'PENTAKILL' },
    { start: 6000, end: 6500, text: 'incrível' },
    { start: 11000, end: 11500, text: 'campeões' },
  ],
  clipStartSec: 5,
  clipEndSec: 15,
  contentType: 'lol-esports',
  clipReason: 'Pentakill no Baron',
};

describe('runThumbnailAnalyst', () => {
  it('retorna offsetSec e rationale em happy path', async () => {
    mockCreate.mockResolvedValue(makeResponse({ offsetSec: 3.5, rationale: 'Reação ao pentakill' }));
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    const result = await runThumbnailAnalyst(BASE_INPUT);

    expect(result.offsetSec).toBe(3.5);
    expect(result.rationale).toBe('Reação ao pentakill');
  });

  it('clamp offsetSec negativo para 0', async () => {
    mockCreate.mockResolvedValue(makeResponse({ offsetSec: -5, rationale: 'test' }));
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    const result = await runThumbnailAnalyst(BASE_INPUT);

    expect(result.offsetSec).toBe(0);
  });

  it('clamp offsetSec acima do limite para clipDuration - 0.5', async () => {
    // clipDuration = 10s → max = 9.5
    mockCreate.mockResolvedValue(makeResponse({ offsetSec: 999, rationale: 'test' }));
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    const result = await runThumbnailAnalyst(BASE_INPUT);

    expect(result.offsetSec).toBe(9.5);
  });

  it('usa "Transcrição não disponível" quando words é vazio', async () => {
    mockCreate.mockResolvedValue(makeResponse({ offsetSec: 2, rationale: 'Frame inicial' }));
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    await runThumbnailAnalyst({ ...BASE_INPUT, words: [] });

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages.find(m => m.role === 'user').content;
    expect(userMsg).toContain('Transcrição não disponível');
  });

  it('retorna offsetSec=0 e rationale vazio quando GPT retorna JSON inválido', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'não é JSON válido' } }],
    });
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    const result = await runThumbnailAnalyst(BASE_INPUT);

    expect(result.offsetSec).toBe(0);
    expect(result.rationale).toBe('');
  });

  it('chama GPT com model gpt-4o-mini e response_format json_object', async () => {
    mockCreate.mockResolvedValue(makeResponse({ offsetSec: 3, rationale: 'test' }));
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    await runThumbnailAnalyst(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
      })
    );
  });

  it('lança erro quando OPENAI_API_KEY ausente', async () => {
    delete process.env.OPENAI_API_KEY;
    const { runThumbnailAnalyst } = require('./thumbnail-analyst');

    await expect(
      runThumbnailAnalyst(BASE_INPUT)
    ).rejects.toThrow('OPENAI_API_KEY');
  });
});
