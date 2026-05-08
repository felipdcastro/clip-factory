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
    on: jest.fn(),
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
  removeUploadJob: jest.fn(),
  getQueuesStatus: jest.fn(),
  startQueueHealthMonitor: jest.fn(),
  stopQueueHealthMonitor: jest.fn(),
  closeQueues: jest.fn(),
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
  connection: {},
}));

const { pool } = require('../db/connection');
const { getQueuesStatus } = require('../queues');
const app = require('../app');

const healthyQueues = {
  transcription: { waiting: 0, active: 0, failed: 0, completed: 5 },
  analysis:      { waiting: 0, active: 0, failed: 0, completed: 5 },
  editor:        { waiting: 0, active: 0, failed: 0, completed: 5 },
  upload:        { waiting: 0, active: 0, failed: 0, completed: 5 },
};

describe('GET /health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    pool.query.mockResolvedValue({ rows: [] });
    mockPing.mockResolvedValue('PONG');
    mockConnect.mockResolvedValue(undefined);
    getQueuesStatus.mockResolvedValue({ ...healthyQueues });
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.HEALTH_FAILED_THRESHOLD;
  });

  it('retorna 200 e status ok quando todos os subsistemas estão saudáveis', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBeDefined();
  });

  it('retorna latency_ms numérico para DB e Redis saudáveis', async () => {
    const res = await request(app).get('/health');
    expect(typeof res.body.subsystems.database.latency_ms).toBe('number');
    expect(typeof res.body.subsystems.redis.latency_ms).toBe('number');
  });

  it('retorna estrutura completa de subsystems', async () => {
    const res = await request(app).get('/health');
    expect(res.body.subsystems.database.status).toBe('ok');
    expect(res.body.subsystems.redis.status).toBe('ok');
    expect(res.body.subsystems.queues).toBeDefined();
  });

  it('retorna 503 e status down quando DB falha', async () => {
    pool.query.mockRejectedValue(new Error('Connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.subsystems.database.status).toBe('down');
  });

  it('retorna 503 e status down quando Redis falha', async () => {
    mockConnect.mockRejectedValue(new Error('Redis unavailable'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.subsystems.redis.status).toBe('down');
  });

  it('retorna 200 e status ok quando REDIS_URL não configurado', async () => {
    delete process.env.REDIS_URL;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.subsystems.redis.status).toBe('not_configured');
  });

  it('retorna 200 e status degraded quando fila tem failed >= threshold (default 5)', async () => {
    getQueuesStatus.mockResolvedValue({
      ...healthyQueues,
      upload: { waiting: 0, active: 0, failed: 5, completed: 10 },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  it('não considera degraded se failed < threshold', async () => {
    getQueuesStatus.mockResolvedValue({
      ...healthyQueues,
      upload: { waiting: 0, active: 0, failed: 4, completed: 10 },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('respeita HEALTH_FAILED_THRESHOLD customizado', async () => {
    process.env.HEALTH_FAILED_THRESHOLD = '3';
    getQueuesStatus.mockResolvedValue({
      ...healthyQueues,
      editor: { waiting: 0, active: 0, failed: 3, completed: 10 },
    });
    const res = await request(app).get('/health');
    expect(res.body.status).toBe('degraded');
  });

  it('retorna contagens das filas nos subsystems', async () => {
    getQueuesStatus.mockResolvedValue({
      transcription: { waiting: 2, active: 1, failed: 0, completed: 10 },
      analysis:      { waiting: 0, active: 0, failed: 0, completed: 5 },
      editor:        { waiting: 5, active: 1, failed: 0, completed: 20 },
      upload:        { waiting: 0, active: 0, failed: 0, completed: 3 },
    });
    const res = await request(app).get('/health');
    expect(res.body.subsystems.queues.transcription).toEqual({ waiting: 2, active: 1, failed: 0 });
    expect(res.body.subsystems.queues.editor).toEqual({ waiting: 5, active: 1, failed: 0 });
  });

  it('inclui header X-Request-ID na resposta', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('propaga X-Request-ID do header da requisição', async () => {
    const customId = 'test-correlation-abc123';
    const res = await request(app).get('/health').set('X-Request-ID', customId);
    expect(res.headers['x-request-id']).toBe(customId);
  });

  it('gera UUID diferente para cada requisição quando X-Request-ID não fornecido', async () => {
    const res1 = await request(app).get('/health');
    const res2 = await request(app).get('/health');
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
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
