'use strict';

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
  class DelayedError extends Error {}
  return { Worker: mockWorker, Queue: jest.fn().mockImplementation(() => ({ close: jest.fn() })), DelayedError };
});

jest.mock('../modules/uploader/uploader.service', () => ({
  processUpload: jest.fn().mockResolvedValue({ id: 1, status: 'uploaded' }),
}));

jest.mock('../queues', () => ({
  connection: {},
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
}));

const { Worker } = require('bullmq');
const { processUpload } = require('../modules/uploader/uploader.service');
const { startUploaderWorker, stopUploaderWorker } = require('./uploader.worker');

describe('startUploaderWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
  });

  it('cria Worker BullMQ na fila de upload com concurrency 1', () => {
    startUploaderWorker();
    expect(Worker).toHaveBeenCalledWith(
      'upload',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('registra handlers de completed e failed', () => {
    const instance = startUploaderWorker();
    expect(instance.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(instance.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('handler chama processUpload com uploadId correto', async () => {
    startUploaderWorker();
    await Worker._handler({ id: 'bull-4', data: { uploadId: 3 } });
    expect(processUpload).toHaveBeenCalledWith(3);
  });

  it('handler completed loga conclusão', () => {
    startUploaderWorker();
    expect(() => mockOnHandlers['completed']({ id: 'j1', data: { uploadId: 3 } })).not.toThrow();
  });

  it('handler failed loga erro com job válido', () => {
    startUploaderWorker();
    expect(() => mockOnHandlers['failed']({ id: 'j1', data: { uploadId: 3 } }, new Error('falhou'))).not.toThrow();
  });

  it('handler failed loga erro com job null (optional chaining)', () => {
    startUploaderWorker();
    expect(() => mockOnHandlers['failed'](null, new Error('falhou'))).not.toThrow();
  });
});

describe('stopUploaderWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
  });

  it('fecha o worker sem erros', async () => {
    startUploaderWorker();
    await expect(stopUploaderWorker()).resolves.toBeUndefined();
  });

  it('não lança se worker não foi iniciado', async () => {
    await expect(stopUploaderWorker()).resolves.toBeUndefined();
  });
});
