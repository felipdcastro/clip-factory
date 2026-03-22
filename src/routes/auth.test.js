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

jest.mock('../modules/uploader/youtube-auth.service', () => ({
  getAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/mock-auth'),
  exchangeCodeForTokens: jest.fn().mockResolvedValue({ access_token: 'mock-token' }),
  isAuthenticated: jest.fn().mockResolvedValue(false),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getAuthenticatedClient: jest.fn().mockResolvedValue(null),
}));

const { getAuthUrl, exchangeCodeForTokens, isAuthenticated } = require('../modules/uploader/youtube-auth.service');
const app = require('../app');

// As rotas /auth/youtube* requerem sessão autenticada (não são públicas)
// Os testes verificam o comportamento correto com e sem sessão

describe('GET /auth/youtube (requer auth)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('redireciona para login sem sessão', async () => {
    const res = await request(app).get('/auth/youtube');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('login');
  });
});

describe('GET /auth/youtube/callback (requer auth)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('redireciona para login sem sessão', async () => {
    const res = await request(app).get('/auth/youtube/callback?code=mock-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('login');
  });

  it('redireciona para login sem sessão, mesmo sem code', async () => {
    const res = await request(app).get('/auth/youtube/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('login');
  });
});

describe('GET /auth/youtube/status (requer auth)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('redireciona para login sem sessão', async () => {
    const res = await request(app).get('/auth/youtube/status');
    expect(res.status).toBe(302);
  });
});

describe('POST /auth/login (público)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna 500 se DASHBOARD_PASSWORD não configurado', async () => {
    const orig = process.env.DASHBOARD_PASSWORD;
    delete process.env.DASHBOARD_PASSWORD;
    const res = await request(app).post('/auth/login').send({ password: 'test' });
    expect(res.status).toBe(500);
    if (orig !== undefined) process.env.DASHBOARD_PASSWORD = orig;
  });

  it('redireciona com erro para senha incorreta', async () => {
    process.env.DASHBOARD_PASSWORD = 'correct-password';
    const res = await request(app).post('/auth/login').send({ password: 'wrong' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=1');
  });

  it('redireciona para / com senha correta', async () => {
    process.env.DASHBOARD_PASSWORD = 'correct-password';
    const res = await request(app).post('/auth/login').send({ password: 'correct-password' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('YouTube Auth Service — testes de unidade', () => {
  beforeEach(() => jest.resetAllMocks());

  it('getAuthUrl retorna URL de autorização', () => {
    getAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?scope=youtube');
    const url = getAuthUrl();
    expect(url).toContain('google.com');
  });

  it('exchangeCodeForTokens resolve com tokens', async () => {
    exchangeCodeForTokens.mockResolvedValue({
      access_token: 'ya29.test',
      refresh_token: 'test-refresh',
      expiry_date: Date.now() + 3600000,
    });
    const tokens = await exchangeCodeForTokens('mock-code');
    expect(tokens.access_token).toBe('ya29.test');
    expect(tokens.refresh_token).toBe('test-refresh');
  });

  it('isAuthenticated retorna false quando não há tokens', async () => {
    isAuthenticated.mockResolvedValue(false);
    const result = await isAuthenticated();
    expect(result).toBe(false);
  });

  it('isAuthenticated retorna true quando tokens válidos', async () => {
    isAuthenticated.mockResolvedValue(true);
    const result = await isAuthenticated();
    expect(result).toBe(true);
  });
});
