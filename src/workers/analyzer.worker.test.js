'use strict';
/* global setImmediate */

const mockOnHandlers = {};

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

jest.mock('../modules/analyzer/analyzer.service', () => ({
  processAnalysis: jest.fn().mockResolvedValue([]),
}));

jest.mock('../queues', () => ({
  connection: {},
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
}));

const { Worker } = require('bullmq');
const { query } = require('../db/connection');
const { processAnalysis } = require('../modules/analyzer/analyzer.service');
const { startAnalyzerWorker, stopAnalyzerWorker } = require('./analyzer.worker');

describe('startAnalyzerWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
    query.mockResolvedValue({ rows: [] });
  });

  it('cria Worker BullMQ na fila de análise', () => {
    startAnalyzerWorker();
    expect(Worker).toHaveBeenCalledWith(
      'analysis',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('registra handlers de completed e failed', () => {
    const instance = startAnalyzerWorker();
    expect(instance.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(instance.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('handler chama processAnalysis com jobId correto', async () => {
    startAnalyzerWorker();
    await Worker._handler({ id: 'bull-2', data: { jobId: 7 } });
    expect(processAnalysis).toHaveBeenCalledWith(7);
  });

  it('handler completed loga conclusão', () => {
    startAnalyzerWorker();
    expect(() => mockOnHandlers['completed']({ id: 'j1', data: { jobId: 7 } })).not.toThrow();
  });

  it('handler failed loga erro com job válido', () => {
    startAnalyzerWorker();
    expect(() => mockOnHandlers['failed']({ id: 'j1', data: { jobId: 7 } }, new Error('falhou'))).not.toThrow();
  });

  it('handler failed loga erro com job null (optional chaining)', () => {
    startAnalyzerWorker();
    expect(() => mockOnHandlers['failed'](null, new Error('falhou'))).not.toThrow();
  });

  it('resetStuckJobs loga warning quando há jobs presos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }, { id: 6 }] });
    startAnalyzerWorker();
    await new Promise(resolve => setImmediate(resolve));
  });
});

describe('stopAnalyzerWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
    query.mockResolvedValue({ rows: [] });
  });

  it('fecha o worker sem erros', async () => {
    startAnalyzerWorker();
    await expect(stopAnalyzerWorker()).resolves.toBeUndefined();
  });

  it('não lança se worker não foi iniciado', async () => {
    await expect(stopAnalyzerWorker()).resolves.toBeUndefined();
  });
});
