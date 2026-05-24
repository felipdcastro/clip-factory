'use strict';

/**
 * Testes de rotas com sessão autenticada.
 * Faz login real via POST /auth/login para obter cookie de sessão.
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
  getQueuesStatus: jest.fn().mockResolvedValue({
    transcription: { waiting: 0, active: 0, failed: 0, completed: 5 },
    analysis: { waiting: 1, active: 0, failed: 0, completed: 3 },
    editor: { waiting: 0, active: 1, failed: 0, completed: 2 },
    upload: { waiting: 0, active: 0, failed: 0, completed: 10 },
  }),
  closeQueues: jest.fn().mockResolvedValue(undefined),
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
  connection: {},
}));

jest.mock('../modules/downloader/job.service', () => ({
  createJob: jest.fn().mockResolvedValue({ id: 1, url: 'https://yt.com/watch?v=abc', status: 'pending' }),
  createJobFromFile: jest.fn().mockResolvedValue({ id: 2, status: 'downloaded' }),
  getJob: jest.fn().mockResolvedValue({ id: 1, status: 'downloaded', url: 'https://yt.com' }),
  listJobs: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
}));

jest.mock('../modules/transcriber/transcription.service', () => ({
  getTranscription: jest.fn().mockResolvedValue({ id: 1, text: 'Texto', words: '[]' }),
}));

jest.mock('../modules/analyzer/analyzer.service', () => ({
  getSuggestions: jest.fn().mockResolvedValue([{ id: 1, type: 'video' }]),
  updateSuggestionStatus: jest.fn().mockResolvedValue({ id: 1, status: 'approved' }),
  getSuggestion: jest.fn().mockResolvedValue(null),
}));

jest.mock('../modules/uploader/uploader.service', () => ({
  processUpload: jest.fn().mockResolvedValue({ id: 1, status: 'uploaded' }),
  retryUpload: jest.fn().mockResolvedValue({ uploadId: 1, status: 'queued' }),
  listUploads: jest.fn().mockResolvedValue([{ id: 1, status: 'queued' }]),
  getUpload: jest.fn().mockResolvedValue({ id: 1, status: 'queued' }),
}));

jest.mock('../modules/uploader/youtube-auth.service', () => ({
  getAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/mock-auth'),
  exchangeCodeForTokens: jest.fn().mockResolvedValue({ access_token: 'mock-token' }),
  isAuthenticated: jest.fn().mockResolvedValue(true),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getAuthenticatedClient: jest.fn().mockResolvedValue({}),
}));

jest.mock('../modules/editor/editor.service', () => ({
  getClip: jest.fn().mockResolvedValue({ id: 1, status: 'ready', file_path: '/tmp/clip.mp4' }),
  processClip: jest.fn().mockResolvedValue({ id: 1, status: 'ready' }),
}));

process.env.DASHBOARD_PASSWORD = 'test-pass-123';
process.env.SESSION_SECRET = 'test-session-secret-for-tests';

const { query } = require('../db/connection');
const { listJobs, getJob, createJob } = require('../modules/downloader/job.service');
const { getTranscription } = require('../modules/transcriber/transcription.service');
const { getSuggestions } = require('../modules/analyzer/analyzer.service');
const { listUploads, getUpload } = require('../modules/uploader/uploader.service');
const { enqueueUpload } = require('../queues');
const { getAuthUrl, exchangeCodeForTokens } = require('../modules/uploader/youtube-auth.service');
const app = require('../app');

// Helper: cria agente autenticado
async function makeAuthAgent() {
  const agent = request.agent(app);
  await agent.post('/auth/login').send({ password: 'test-pass-123' });
  return agent;
}

describe('GET /api/jobs (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna lista de jobs', async () => {
    const agent = await makeAuthAgent();
    listJobs.mockResolvedValue([{ id: 1, status: 'pending' }, { id: 2, status: 'downloaded' }]);
    const res = await agent.get('/api/jobs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /api/jobs/:id (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 para ID inválido', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.get('/api/jobs/nao-um-numero');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ID inválido');
  });

  it('retorna 404 para job inexistente', async () => {
    const agent = await makeAuthAgent();
    getJob.mockResolvedValueOnce(null);
    const res = await agent.get('/api/jobs/999');
    expect(res.status).toBe(404);
  });

  it('retorna job existente', async () => {
    const agent = await makeAuthAgent();
    getJob.mockResolvedValueOnce({ id: 1, status: 'downloaded', url: 'https://yt.com' });
    const res = await agent.get('/api/jobs/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});

describe('POST /api/jobs (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 sem URL', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.post('/api/jobs').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('"url"');
  });

  it('cria job e retorna 201', async () => {
    const agent = await makeAuthAgent();
    createJob.mockResolvedValueOnce({ id: 3, url: 'https://yt.com/watch?v=abc', status: 'pending' });
    const res = await agent.post('/api/jobs').send({ url: 'https://yt.com/watch?v=abc' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(3);
  });

  it('retorna 400 se createJob lança com status 400', async () => {
    const agent = await makeAuthAgent();
    const err = Object.assign(new Error('URL inválida'), { status: 400 });
    createJob.mockRejectedValueOnce(err);
    const res = await agent.post('/api/jobs').send({ url: 'https://not-youtube.com' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/jobs/:id/transcription (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se job não existe', async () => {
    const agent = await makeAuthAgent();
    getJob.mockResolvedValueOnce(null);
    const res = await agent.get('/api/jobs/1/transcription');
    expect(res.status).toBe(404);
  });

  it('retorna 404 se transcrição não está disponível', async () => {
    const agent = await makeAuthAgent();
    getJob.mockResolvedValueOnce({ id: 1, status: 'downloaded' });
    getTranscription.mockResolvedValueOnce(null);
    const res = await agent.get('/api/jobs/1/transcription');
    expect(res.status).toBe(404);
    expect(res.body.job_status).toBe('downloaded');
  });

  it('retorna transcrição quando disponível', async () => {
    const agent = await makeAuthAgent();
    getJob.mockResolvedValueOnce({ id: 1, status: 'transcribed' });
    getTranscription.mockResolvedValueOnce({ id: 1, text: 'Texto transcrito' });
    const res = await agent.get('/api/jobs/1/transcription');
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Texto transcrito');
  });
});

describe('GET /api/jobs/:id/suggestions (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna sugestões do job', async () => {
    const agent = await makeAuthAgent();
    getJob.mockResolvedValueOnce({ id: 1, status: 'analyzed' });
    getSuggestions.mockResolvedValueOnce([{ id: 1, type: 'video' }, { id: 2, type: 'reel' }]);
    const res = await agent.get('/api/jobs/1/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(2);
    expect(res.body.job_status).toBe('analyzed');
  });
});

describe('GET /api/uploads (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lista uploads', async () => {
    const agent = await makeAuthAgent();
    listUploads.mockResolvedValueOnce([{ id: 1, status: 'queued' }]);
    const res = await agent.get('/api/uploads');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/uploads/:id (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 404 se upload não encontrado', async () => {
    const agent = await makeAuthAgent();
    getUpload.mockResolvedValueOnce(null);
    const res = await agent.get('/api/uploads/999');
    expect(res.status).toBe(404);
  });

  it('retorna upload existente', async () => {
    const agent = await makeAuthAgent();
    getUpload.mockResolvedValueOnce({ id: 1, status: 'queued' });
    const res = await agent.get('/api/uploads/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});

describe('POST /api/uploads (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 400 sem clip_id e title', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.post('/api/uploads').send({});
    expect(res.status).toBe(400);
  });

  it('retorna 404 se clip não existe', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [] }); // clip não encontrado
    const res = await agent.post('/api/uploads').send({ clip_id: 999, title: 'Teste' });
    expect(res.status).toBe(404);
  });

  it('retorna 400 se clip não está ready', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'cutting' }] });
    const res = await agent.post('/api/uploads').send({ clip_id: 1, title: 'Teste' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('pronto');
  });

  it('agenda upload e retorna 201', async () => {
    const agent = await makeAuthAgent();
    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'ready' }] }) // SELECT clip
      .mockResolvedValueOnce({ rows: [{ id: 1, clip_id: 1, title: 'Teste', status: 'queued' }] }); // INSERT upload
    enqueueUpload.mockResolvedValueOnce(undefined);
    const res = await agent.post('/api/uploads').send({ clip_id: 1, title: 'Vídeo de teste' });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/uploads/:id/retry (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enfileira retry via BullMQ e retorna status queued', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.post('/api/uploads/1/retry');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('queued');
    expect(res.body.upload_id).toBe(1);
  });
});

describe('GET /api/queues/status (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna status das filas', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.get('/api/queues/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queues');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /auth/logout (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('destrói sessão e redireciona para login', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('login');
  });
});

describe('GET /auth/youtube (autenticado)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
  });

  it('redireciona para URL de autorização Google', async () => {
    const agent = await makeAuthAgent();
    getAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth');
    const res = await agent.get('/auth/youtube');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('retorna 500 se YOUTUBE_CLIENT_ID não configurado', async () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    const agent = await makeAuthAgent();
    const res = await agent.get('/auth/youtube');
    expect(res.status).toBe(500);
  });
});

describe('GET /auth/youtube/callback (autenticado)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
  });

  /**
   * Helper: inicia o flow OAuth completo para obter o state gerado pela sessão.
   * Visita /auth/youtube (que grava oauthState na sessão) e extrai o state
   * inspecionando o argumento passado ao mock de getAuthUrl.
   */
  async function startOAuthFlow(agent) {
    getAuthUrl.mockReturnValueOnce('https://accounts.google.com/mock-auth');
    await agent.get('/auth/youtube');
    // O state foi passado como primeiro argumento ao mock de getAuthUrl
    return getAuthUrl.mock.calls[getAuthUrl.mock.calls.length - 1][0];
  }

  it('redireciona para sucesso após trocar código com state válido', async () => {
    const agent = await makeAuthAgent();
    const state = await startOAuthFlow(agent);
    exchangeCodeForTokens.mockResolvedValueOnce({ access_token: 'ya29.token' });
    const res = await agent.get(`/auth/youtube/callback?code=mock-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('youtube_auth=success');
  });

  it('redireciona para erro se callback recebe error param (sem validar state)', async () => {
    const agent = await makeAuthAgent();
    const res = await agent.get('/auth/youtube/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('youtube_auth=error');
  });

  it('redireciona para erro se state não coincide (CSRF)', async () => {
    const agent = await makeAuthAgent();
    await startOAuthFlow(agent); // define oauthState na sessão
    const res = await agent.get('/auth/youtube/callback?code=mock-code&state=estado-errado');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('youtube_auth=error');
  });

  it('redireciona para erro se state ausente', async () => {
    const agent = await makeAuthAgent();
    await startOAuthFlow(agent);
    const res = await agent.get('/auth/youtube/callback?code=mock-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('youtube_auth=error');
  });

  it('redireciona para erro se exchangeCodeForTokens lança', async () => {
    const agent = await makeAuthAgent();
    const state = await startOAuthFlow(agent);
    exchangeCodeForTokens.mockRejectedValueOnce(new Error('OAuth falhou'));
    const res = await agent.get(`/auth/youtube/callback?code=bad-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('youtube_auth=error');
  });
});

describe('GET /auth/youtube/status (autenticado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna status=connected quando token válido', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [{ auth_status: 'active', expires_at: new Date() }] });
    const res = await agent.get('/auth/youtube/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
  });

  it('retorna status=disconnected quando sem token', async () => {
    const agent = await makeAuthAgent();
    query.mockResolvedValueOnce({ rows: [] });
    const res = await agent.get('/auth/youtube/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disconnected');
  });
});
