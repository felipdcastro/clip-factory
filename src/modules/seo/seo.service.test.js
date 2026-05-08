'use strict';

jest.mock('../../db/connection', () => ({ query: jest.fn() }));
jest.mock('./seo-analyst', () => ({ runSEOAnalyst: jest.fn() }));
jest.mock('./seo-copywriter', () => ({ runSEOCopywriter: jest.fn() }));
jest.mock('./thumbnail-analyst', () => ({ runThumbnailAnalyst: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), error: jest.fn() }),
}));
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  unlinkSync: jest.fn(),
}));

const { query }              = require('../../db/connection');
const { runSEOAnalyst }      = require('./seo-analyst');
const { runSEOCopywriter }   = require('./seo-copywriter');
const { runThumbnailAnalyst } = require('./thumbnail-analyst');
const { runSEOSquad }        = require('./seo.service');

const SUGGESTION_ROW = {
  id: 'sug-1',
  title: 'Pentakill incrível na final',
  reason: 'Pentakill no Baron',
  clip_category: 'highlight',
  type: 'clip',
  start_time: '5.0',
  end_time: '15.0',
  content_type: 'lol-esports',
  video_title: 'CBLOL 2025 Final',
};

const ANALYST_RESULT = {
  primaryKeyword: 'League of Legends',
  secondaryKeywords: ['CBLOL highlights'],
  tags: ['lol', 'cblol', 'esports'],
  seoScore: 82,
  strategy: 'Foco em keywords de nicho',
};

const COPYWRITER_RESULT = {
  title: 'PENTAKILL ÉPICO na Final do CBLOL 2025 🔥',
  description: 'League of Legends CBLOL 2025 — Pentakill incrível.',
};

const THUMBNAIL_RESULT = { offsetSec: 3.5, rationale: 'Reação ao pentakill' };

beforeEach(() => {
  jest.resetAllMocks();
  query
    .mockResolvedValueOnce({ rows: [SUGGESTION_ROW] })
    .mockResolvedValueOnce({ rows: [{ words: [] }] })
    .mockResolvedValueOnce({ rows: [] });
  runSEOAnalyst.mockResolvedValue(ANALYST_RESULT);
  runSEOCopywriter.mockResolvedValue(COPYWRITER_RESULT);
  runThumbnailAnalyst.mockResolvedValue(THUMBNAIL_RESULT);
});

describe('runSEOSquad', () => {
  it('retorna resultado consolidado em happy path', async () => {
    const result = await runSEOSquad('sug-1');

    expect(result.seoTitle).toBe(COPYWRITER_RESULT.title);
    expect(result.seoScore).toBe(ANALYST_RESULT.seoScore);
    expect(result.thumbnailOffsetSec).toBe(THUMBNAIL_RESULT.offsetSec);
    expect(Array.isArray(result.seoTags)).toBe(true);
    expect(result.strategy).toBe(ANALYST_RESULT.strategy);
  });

  it('chama SEO Analyst antes de Copywriter e ThumbnailAnalyst', async () => {
    const callOrder = [];
    runSEOAnalyst.mockImplementation(async () => { callOrder.push('analyst'); return ANALYST_RESULT; });
    runSEOCopywriter.mockImplementation(async () => { callOrder.push('copywriter'); return COPYWRITER_RESULT; });
    runThumbnailAnalyst.mockImplementation(async () => { callOrder.push('thumbnail'); return THUMBNAIL_RESULT; });

    await runSEOSquad('sug-1');

    expect(callOrder[0]).toBe('analyst');
    expect(callOrder).toContain('copywriter');
    expect(callOrder).toContain('thumbnail');
  });

  it('salva resultados no banco com valores corretos', async () => {
    await runSEOSquad('sug-1');

    const updateCall = query.mock.calls[2];
    expect(updateCall[0]).toMatch(/UPDATE clip_suggestions/);
    expect(updateCall[1]).toEqual([
      COPYWRITER_RESULT.title,
      COPYWRITER_RESULT.description,
      JSON.stringify(ANALYST_RESULT.tags),
      THUMBNAIL_RESULT.offsetSec,
      ANALYST_RESULT.seoScore,
      'sug-1',
    ]);
  });

  it('lança erro 404 quando sugestão não encontrada', async () => {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [] });

    const err = await runSEOSquad('invalid-id').catch(e => e);

    expect(err.message).toBe('Sugestão não encontrada');
    expect(err.status).toBe(404);
  });

  it('não chama os agentes quando sugestão não existe', async () => {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [] });

    await runSEOSquad('invalid-id').catch(() => {});

    expect(runSEOAnalyst).not.toHaveBeenCalled();
    expect(runSEOCopywriter).not.toHaveBeenCalled();
    expect(runThumbnailAnalyst).not.toHaveBeenCalled();
  });
});
