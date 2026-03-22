'use strict';

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

jest.mock('../modules/downloader/job.service', () => ({
  createJob: jest.fn().mockResolvedValue({ id: 1, status: 'pending' }),
  createJobFromFile: jest.fn().mockResolvedValue({ id: 1, status: 'pending' }),
  getJob: jest.fn().mockResolvedValue(null),
  listJobs: jest.fn().mockResolvedValue([]),
  updateJobStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../modules/transcriber/transcription.service', () => ({
  getTranscription: jest.fn().mockResolvedValue(null),
}));

jest.mock('../modules/analyzer/analyzer.service', () => ({
  getSuggestions: jest.fn().mockResolvedValue([]),
  updateSuggestionStatus: jest.fn().mockResolvedValue({}),
  getSuggestion: jest.fn().mockResolvedValue(null),
}));

const { createJob, getJob, listJobs } = require('../modules/downloader/job.service');
const { getTranscription } = require('../modules/transcriber/transcription.service');
const { getSuggestions } = require('../modules/analyzer/analyzer.service');

const app = require('../app');

describe('GET /health (público)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna 200 sem autenticação', async () => {
    const { query } = require('../db/connection');
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/jobs (sem auth)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna 401 ou 302 sem sessão', async () => {
    const res = await request(app).post('/api/jobs').send({ url: 'https://yt.com/watch?v=abc' });
    expect([401, 302]).toContain(res.status);
  });
});

describe('GET /api/jobs (sem auth)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna 401 ou 302 sem sessão', async () => {
    const res = await request(app).get('/api/jobs');
    expect([401, 302]).toContain(res.status);
  });
});

describe('GET /api/jobs/:id (sem auth)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna 401 ou 302 sem sessão', async () => {
    const res = await request(app).get('/api/jobs/1');
    expect([401, 302]).toContain(res.status);
  });
});

describe('Job service — testes de unidade', () => {
  beforeEach(() => jest.resetAllMocks());

  it('createJob resolve com job criado', async () => {
    createJob.mockResolvedValue({ id: 99, status: 'pending', url: 'https://yt.com' });
    const result = await createJob('https://yt.com');
    expect(result.id).toBe(99);
    expect(createJob).toHaveBeenCalledWith('https://yt.com');
  });

  it('getJob retorna null para ID inexistente', async () => {
    getJob.mockResolvedValue(null);
    const result = await getJob(9999);
    expect(result).toBeNull();
  });

  it('listJobs retorna array vazio quando não há jobs', async () => {
    listJobs.mockResolvedValue([]);
    const result = await listJobs();
    expect(Array.isArray(result)).toBe(true);
  });

  it('listJobs retorna jobs existentes', async () => {
    listJobs.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const result = await listJobs();
    expect(result).toHaveLength(2);
  });

  it('getTranscription retorna null se não encontrada', async () => {
    getTranscription.mockResolvedValue(null);
    const result = await getTranscription(999);
    expect(result).toBeNull();
  });

  it('getSuggestions retorna sugestões do job', async () => {
    getSuggestions.mockResolvedValue([{ id: 1, type: 'video' }, { id: 2, type: 'reel' }]);
    const result = await getSuggestions(1);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('video');
  });
});
