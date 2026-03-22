'use strict';

const request = require('supertest');

// Mock ioredis antes de carregar o app
const mockPing = jest.fn().mockResolvedValue('PONG');
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    ping: mockPing,
    disconnect: mockDisconnect,
  }));
});

// Mock DB
jest.mock('../db/connection', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  testConnection: jest.fn().mockResolvedValue(true),
}));

jest.mock('../queues', () => ({
  enqueueTranscription: jest.fn(),
  enqueueAnalysis: jest.fn(),
  enqueueClip: jest.fn(),
  enqueueUpload: jest.fn(),
  getQueuesStatus: jest.fn().mockResolvedValue({}),
  closeQueues: jest.fn(),
  QUEUE_NAMES: {},
  connection: {},
}));

const { pool } = require('../db/connection');
const app = require('../app');

describe('GET /health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    pool.query.mockResolvedValue({ rows: [] });
    mockPing.mockResolvedValue('PONG');
    mockConnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it('retorna status ok quando DB e Redis estão saudáveis', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.db).toBe('ok');
    expect(res.body.services.redis).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.version).toBeDefined();
  });

  it('retorna status ok quando REDIS_URL não configurado', async () => {
    delete process.env.REDIS_URL;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.redis).toBe('not_configured');
  });

  it('retorna status degraded e 503 quando DB falha', async () => {
    pool.query.mockRejectedValue(new Error('Connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.db).toBe('error');
  });

  it('retorna status degraded e 503 quando Redis falha', async () => {
    mockPing.mockRejectedValue(new Error('Redis unavailable'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.redis).toBe('error');
  });
});

describe('404 handler', () => {
  it('redireciona requests não autenticados para login', async () => {
    const res = await request(app).get('/rota-inexistente');
    expect([302, 404]).toContain(res.status);
  });

  it('retorna 404 JSON para rotas de API inexistentes (autenticado)', async () => {
    process.env.DASHBOARD_PASSWORD = 'test-pwd';
    process.env.SESSION_SECRET = 'test-secret';
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ password: 'test-pwd' });
    const res = await agent.get('/api/rota-inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('não encontrada');
  });
});
