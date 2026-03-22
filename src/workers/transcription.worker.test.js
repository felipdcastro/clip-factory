'use strict';
/* global setImmediate */

const mockOnHandlers = {};

// Mock BullMQ antes de qualquer require
jest.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: jest.fn().mockImplementation((event, handler) => {
      mockOnHandlers[event] = handler;
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockWorker = jest.fn().mockImplementation((queueName, handler, _opts) => {
    mockWorker._handler = handler;
    return mockWorkerInstance;
  });
  mockWorker._instance = mockWorkerInstance;
  return { Worker: mockWorker, Queue: jest.fn().mockImplementation(() => ({ close: jest.fn() })) };
});

jest.mock('../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../modules/transcriber/transcription.service', () => ({
  processTranscription: jest.fn().mockResolvedValue({ text: 'ok' }),
}));

jest.mock('../queues', () => ({
  connection: {},
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
  enqueueAnalysis: jest.fn().mockResolvedValue(undefined),
  enqueueTranscription: jest.fn().mockResolvedValue(undefined),
  enqueueClip: jest.fn().mockResolvedValue(undefined),
  enqueueUpload: jest.fn().mockResolvedValue(undefined),
  closeQueues: jest.fn().mockResolvedValue(undefined),
}));

const { Worker } = require('bullmq');
const { query } = require('../db/connection');
const { processTranscription } = require('../modules/transcriber/transcription.service');
const { startTranscriptionWorker, stopTranscriptionWorker } = require('./transcription.worker');

describe('startTranscriptionWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mockOnHandlers
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
    query.mockResolvedValue({ rows: [] }); // resetStuckJobs retorna vazio por padrão
  });

  it('cria Worker BullMQ na fila de transcrição', () => {
    startTranscriptionWorker();
    expect(Worker).toHaveBeenCalledWith(
      'transcription',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('registra handlers de completed e failed', () => {
    const instance = startTranscriptionWorker();
    expect(instance.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(instance.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('handler chama processTranscription com o jobId correto', async () => {
    startTranscriptionWorker();
    await Worker._handler({ id: 'bull-1', data: { jobId: 42 } });
    expect(processTranscription).toHaveBeenCalledWith(42);
  });

  it('handler completed loga conclusão', () => {
    startTranscriptionWorker();
    // Chama o handler de completed sem erros
    expect(() => mockOnHandlers['completed']({ id: 'j1', data: { jobId: 1 } })).not.toThrow();
  });

  it('handler failed loga erro com job válido', () => {
    startTranscriptionWorker();
    expect(() => mockOnHandlers['failed']({ id: 'j1', data: { jobId: 1 } }, new Error('falhou'))).not.toThrow();
  });

  it('handler failed loga erro com job null (optional chaining)', () => {
    startTranscriptionWorker();
    expect(() => mockOnHandlers['failed'](null, new Error('falhou'))).not.toThrow();
  });

  it('resetStuckJobs loga warning quando há jobs presos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 10 }, { id: 11 }] });
    startTranscriptionWorker();
    // Aguarda a promise do resetStuckJobs
    await new Promise(resolve => setImmediate(resolve));
  });
});

describe('stopTranscriptionWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
    query.mockResolvedValue({ rows: [] });
  });

  it('fecha o worker sem erros', async () => {
    startTranscriptionWorker();
    await expect(stopTranscriptionWorker()).resolves.toBeUndefined();
  });

  it('não lança se worker não foi iniciado', async () => {
    await expect(stopTranscriptionWorker()).resolves.toBeUndefined();
  });
});
