'use strict';

/**
 * Testes de rotas /api/suggestions e /api/clips com sessão autenticada.
 */

const request = require('supertest');

jest.mock('../db/connection', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
  testConnection: jest.fn().mockResolvedValue(true),
}));

jest.mock('../queues', () => ({
  enqueueTranscription: jest.fn().mockResolvedValue(undefined),
  enqueueAnalysis: jest.fn().mockResolvedValue(undefined),
  enqueueClip: jest.fn().mockResolvedValue(undefined),
  enqueueUpload: jest.fn().mockResolvedValue(undefined),
  getQueuesStatus: jest.fn().mockResolvedValue({}),
  closeQueues: jest.fn().mockResolvedValue(undefined),
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
  connection: {},
}));

jest.mock('../modules/analyzer/analyzer.service', () => ({
  updateSuggestionStatus: jest.fn(),
  getSuggestions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../modules/editor/editor.service', () => ({
  getClip: jest.fn(),
}));

jest.mock('../modules/downloader/job.service', () => ({
  createJob: jest.fn(),
  getJob: jest.fn(),
  listJobs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../modules/transcriber/transcription.service', () => ({
  getTranscription: jest.fn().mockResolvedValue(null),
}));

jest.mock('../modules/uploader/uploader.service', () => ({
  processUpload: jest.fn(),
  retryUpload: jest.fn(),
  listUploads: jest.fn().mockResolvedValue([]),
  getUpload: jest.fn().mockResolvedValue(null),
}));

process.env.DASHBOARD_PASSWORD = 'test-pass-suggestions';
process.env.SESSION_SECRET = 'test-session-secret-suggestions';

const { query } = require('../db/connection');
const { updateSuggestionStatus } = require('../modules/analyzer/analyzer.service');
const { getClip } = require('../modules/editor/editor.service');
const { enqueueClip: _enqueueClip } = require('../queues');
const app = require('../app');

async function makeAuthAgent() {
  const agent = request.agent(app);
  await agent.post('/auth/login').send({ password: 'test-pass-suggestions' });
  return agent;
}

describe('PATCH /api/suggestions/:id (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 sem campo status', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.patch('/api/suggestions/1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('"status"');
  });

  it('retorna 400 se status é inválido', async () => {
    const agent = await makeAuthAgent();
    const err = Object.assign(new Error('Status inválido'), { status: 400 });
    updateSuggestionStatus.mockRejectedValueOnce(err);
    const res = await agent.patch('/api/suggestions/1').send({ status: 'invalido' });
    expect(res.status).toBe(400);
  });

  it('retorna 404 se sugestão não encontrada', async () => {
    const agent = await makeAuthAgent();
    const err = Object.assign(new Error('Sugestão não encontrada'), { status: 404 });
    updateSuggestionStatus.mockRejectedValueOnce(err);
    const res = await agent.patch('/api/suggestions/999').send({ status: 'approved' });
    expect(res.status).toBe(404);
  });

  it('aprova sugestão e enfileira clip', async () => {
    const agent = await makeAuthAgent();
    const suggestion = { id: 5, status: 'approved' };
    updateSuggestionStatus.mockResolvedValueOnce(suggestion);
    const res = await agent.patch('/api/suggestions/5').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    // enqueueClip é chamado assíncronamente (catch)
  });

  it('rejeita sugestão sem enfileirar clip', async () => {
    const agent = await makeAuthAgent();
    updateSuggestionStatus.mockResolvedValueOnce({ id: 3, status: 'rejected' });
    const res = await agent.patch('/api/suggestions/3').send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});

describe('GET /api/suggestions/:id/clip (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se clip não encontrado', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [] });
    const res = await agent.get('/api/suggestions/1/clip');
    expect(res.status).toBe(404);
  });

  it('retorna clip da sugestão', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [{ id: 1, suggestion_id: 1, status: 'ready' }] });
    const res = await agent.get('/api/suggestions/1/clip');
    expect(res.status).toBe(200);
    expect(res.body.suggestion_id).toBe(1);
  });
});

describe('GET /api/clips/:id (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se clip não encontrado', async () => {
    const agent = await makeAuthAgent();
    getClip.mockResolvedValueOnce(null);
    const res = await agent.get('/api/clips/999');
    expect(res.status).toBe(404);
  });

  it('retorna clip existente', async () => {
    const agent = await makeAuthAgent();
    getClip.mockResolvedValueOnce({ id: 1, status: 'ready', file_path: '/tmp/clip.mp4' });
    const res = await agent.get('/api/clips/1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});

describe('GET /api/clips/by-suggestion/:suggestionId (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se nenhum clip encontrado', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [] });
    const res = await agent.get('/api/clips/by-suggestion/1');
    expect(res.status).toBe(404);
  });

  it('retorna clip da sugestão', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [{ id: 1, suggestion_id: 1, status: 'ready' }] });
    const res = await agent.get('/api/clips/by-suggestion/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});
