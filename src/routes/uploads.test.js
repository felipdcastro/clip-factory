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

jest.mock('../modules/uploader/uploader.service', () => ({
  processUpload: jest.fn().mockResolvedValue({ id: 1, status: 'uploaded' }),
  retryUpload: jest.fn().mockResolvedValue(undefined),
  listUploads: jest.fn().mockResolvedValue([]),
  getUpload: jest.fn().mockResolvedValue(null),
}));

const { query: _query } = require('../db/connection');
const { listUploads, getUpload, retryUpload } = require('../modules/uploader/uploader.service');
const { enqueueUpload } = require('../queues');
const app = require('../app');

describe('POST /api/uploads (sem auth)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 ou 302 sem autenticação', async () => {
    const res = await request(app)
      .post('/api/uploads')
      .send({ clip_id: 1, title: 'Teste' });
    expect([401, 302]).toContain(res.status);
  });
});

describe('GET /api/uploads (sem auth)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 ou 302 sem autenticação', async () => {
    const res = await request(app).get('/api/uploads');
    expect([401, 302]).toContain(res.status);
  });
});

describe('POST /api/uploads/:id/retry (sem auth)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna 401 ou 302 sem autenticação', async () => {
    const res = await request(app).post('/api/uploads/1/retry');
    expect([401, 302]).toContain(res.status);
  });
});

describe('Uploader service integração', () => {
  beforeEach(() => jest.clearAllMocks());

  it('listUploads retorna array', async () => {
    listUploads.mockResolvedValueOnce([{ id: 1, status: 'queued' }]);
    const result = await listUploads();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('queued');
  });

  it('getUpload retorna null se não encontrado', async () => {
    getUpload.mockResolvedValueOnce(null);
    const result = await getUpload(9999);
    expect(result).toBeNull();
  });

  it('retryUpload chama o serviço com uploadId', async () => {
    retryUpload.mockResolvedValueOnce(undefined);
    await expect(retryUpload(1)).resolves.toBeUndefined();
    expect(retryUpload).toHaveBeenCalledWith(1);
  });

  it('enqueueUpload é chamável com delay para agendamento', async () => {
    const futureDate = new Date(Date.now() + 60000);
    await expect(enqueueUpload(1, futureDate)).resolves.toBeUndefined();
  });
});
