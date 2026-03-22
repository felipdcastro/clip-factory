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
  return { Worker: mockWorker, Queue: jest.fn().mockImplementation(() => ({ close: jest.fn() })) };
});

jest.mock('../modules/editor/editor.service', () => ({
  processClip: jest.fn().mockResolvedValue({ id: 1, status: 'ready' }),
}));

jest.mock('../queues', () => ({
  connection: {},
  QUEUE_NAMES: { TRANSCRIPTION: 'transcription', ANALYSIS: 'analysis', EDITOR: 'editor', UPLOAD: 'upload' },
}));

const { Worker } = require('bullmq');
const { processClip } = require('../modules/editor/editor.service');
const { startEditorWorker, stopEditorWorker } = require('./editor.worker');

describe('startEditorWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
  });

  it('cria Worker BullMQ na fila do editor com concurrency 2', () => {
    startEditorWorker();
    expect(Worker).toHaveBeenCalledWith(
      'editor',
      expect.any(Function),
      expect.objectContaining({ concurrency: 2 })
    );
  });

  it('registra handlers de completed e failed', () => {
    const instance = startEditorWorker();
    expect(instance.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(instance.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('handler chama processClip com suggestionId correto', async () => {
    startEditorWorker();
    await Worker._handler({ id: 'bull-3', data: { suggestionId: 5 } });
    expect(processClip).toHaveBeenCalledWith(5);
  });

  it('handler completed loga conclusão', () => {
    startEditorWorker();
    expect(() => mockOnHandlers['completed']({ id: 'j1', data: { suggestionId: 5 } })).not.toThrow();
  });

  it('handler failed loga erro com job válido', () => {
    startEditorWorker();
    expect(() => mockOnHandlers['failed']({ id: 'j1', data: { suggestionId: 5 } }, new Error('falhou'))).not.toThrow();
  });

  it('handler failed loga erro com job null (optional chaining)', () => {
    startEditorWorker();
    expect(() => mockOnHandlers['failed'](null, new Error('falhou'))).not.toThrow();
  });
});

describe('stopEditorWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockOnHandlers).forEach(k => delete mockOnHandlers[k]);
  });

  it('fecha o worker sem erros', async () => {
    startEditorWorker();
    await expect(stopEditorWorker()).resolves.toBeUndefined();
  });

  it('não lança se worker não foi iniciado', async () => {
    await expect(stopEditorWorker()).resolves.toBeUndefined();
  });
});
