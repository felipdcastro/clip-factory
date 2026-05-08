'use strict';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

// Reseta singleton entre testes
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
  tags: ['lol', 'cblol', 'esports'],
  seoScore: 82,
  strategy: 'Foco em keywords de nicho de alto engajamento',
};

describe('runSEOAnalyst', () => {
  it('retorna resultado estruturado em happy path', async () => {
    mockCreate.mockResolvedValue(makeResponse(ANALYST_RESULT));
    const { runSEOAnalyst } = require('./seo-analyst');

    const result = await runSEOAnalyst({
      contentType: 'lol-esports',
      clipTitle: 'Pentakill incrível na final',
      clipReason: 'Pentakill no Baron',
      clipCategory: 'highlight',
      videoTitle: 'CBLOL 2025 Final',
    });

    expect(result.primaryKeyword).toBe('League of Legends');
    expect(result.seoScore).toBe(82);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(result.strategy).toBeDefined();
  });

  it('chama GPT com model gpt-4o-mini e response_format json_object', async () => {
    mockCreate.mockResolvedValue(makeResponse(ANALYST_RESULT));
    const { runSEOAnalyst } = require('./seo-analyst');

    await runSEOAnalyst({ contentType: 'mbl', clipTitle: 'Debate acalorado', clipReason: '' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
      })
    );
  });

  it('usa contexto genérico para contentType desconhecido', async () => {
    mockCreate.mockResolvedValue(makeResponse(ANALYST_RESULT));
    const { runSEOAnalyst } = require('./seo-analyst');

    await runSEOAnalyst({ contentType: 'desconhecido', clipTitle: 'Clip qualquer' });

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages.find(m => m.role === 'user').content;
    expect(userMsg).toContain('audiência geral');
  });

  it('lança erro estruturado quando GPT retorna JSON inválido', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'não é JSON' } }],
    });
    const { runSEOAnalyst } = require('./seo-analyst');

    await expect(
      runSEOAnalyst({ contentType: 'mbl', clipTitle: 'Clip' })
    ).rejects.toThrow('SEO Analyst retornou JSON inválido');
  });

  it('lança erro quando OPENAI_API_KEY ausente', async () => {
    delete process.env.OPENAI_API_KEY;
    const { runSEOAnalyst } = require('./seo-analyst');

    await expect(
      runSEOAnalyst({ contentType: 'mbl', clipTitle: 'Clip' })
    ).rejects.toThrow('OPENAI_API_KEY');
  });

  it('não chama a API quando OPENAI_API_KEY ausente', async () => {
    delete process.env.OPENAI_API_KEY;
    const { runSEOAnalyst } = require('./seo-analyst');

    await runSEOAnalyst({ contentType: 'mbl', clipTitle: 'Clip' }).catch(() => {});
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
