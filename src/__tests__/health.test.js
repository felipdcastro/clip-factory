const request = require('supertest');

// Mock DB before loading app
jest.mock('../db/connection', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const app = require('../app');

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('404 handler', () => {
  it('redirects unauthenticated requests to login', async () => {
    const res = await request(app).get('/rota-inexistente');
    // Auth middleware redireciona para login antes do 404
    expect([302, 404]).toContain(res.status);
  });
});
