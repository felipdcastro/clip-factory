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

const ANALYST_RESULT = {
  primaryKeyword: 'League of Legends',
  secondaryKeywords: ['CBLOL highlights', 'LoL clips'],
  strategy: 'Foco em keywords de nicho de alto engajamento',
};

const COPYWRITER_RESULT = {
  title: 'PENTAKILL ÉPICO na Final do CBLOL 2025 🔥',
  description: 'League of Legends CBLOL 2025 — Pentakill incrível na final.',
};

const BASE_INPUT = {
  contentType: 'lol-esports',
  clipTitle: 'Pentakill incrível na final',
  clipReason: 'Pentakill no Baron',
  clipCategory: 'highlight',
  videoTitle: 'CBLOL 2025 Final',
  analystResult: ANALYST_RESULT,
};

describe('runSEOCopywriter', () => {
  it('retorna resultado estruturado em happy path', async () => {
    mockCreate.mockResolvedValue(makeResponse(COPYWRITER_RESULT));
    const { runSEOCopywriter } = require('./seo-copywriter');

    const result = await runSEOCopywriter(BASE_INPUT);

    expect(result.title).toBe(COPYWRITER_RESULT.title);
    expect(result.description).toBeDefined();
  });

  it('chama GPT com model gpt-4o-mini e response_format json_object', async () => {
    mockCreate.mockResolvedValue(makeResponse(COPYWRITER_RESULT));
    const { runSEOCopywriter } = require('./seo-copywriter');

    await runSEOCopywriter(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
      })
    );
  });

  it('lança erro estruturado quando GPT retorna JSON inválido', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'não é JSON' } }],
    });
    const { runSEOCopywriter } = require('./seo-copywriter');

    await expect(
      runSEOCopywriter(BASE_INPUT)
    ).rejects.toThrow('SEO Copywriter retornou JSON inválido');
  });

  it('lança erro quando OPENAI_API_KEY ausente', async () => {
    delete process.env.OPENAI_API_KEY;
    const { runSEOCopywriter } = require('./seo-copywriter');

    await expect(
      runSEOCopywriter(BASE_INPUT)
    ).rejects.toThrow('OPENAI_API_KEY');
  });

  it('não chama a API quando OPENAI_API_KEY ausente', async () => {
    delete process.env.OPENAI_API_KEY;
    const { runSEOCopywriter } = require('./seo-copywriter');

    await runSEOCopywriter(BASE_INPUT).catch(() => {});
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
