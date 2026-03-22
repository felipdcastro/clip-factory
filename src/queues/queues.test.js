'use strict';

// Mock BullMQ antes de qualquer require
const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'bull-1' });
const mockQueueGetWaiting = jest.fn().mockResolvedValue(0);
const mockQueueGetActive = jest.fn().mockResolvedValue(0);
const mockQueueGetFailed = jest.fn().mockResolvedValue(0);
const mockQueueGetCompleted = jest.fn().mockResolvedValue(0);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getWaitingCount: mockQueueGetWaiting,
    getActiveCount: mockQueueGetActive,
    getFailedCount: mockQueueGetFailed,
    getCompletedCount: mockQueueGetCompleted,
    close: mockQueueClose,
  })),
}));

// Garante REDIS_URL antes de importar queues
process.env.REDIS_URL = 'redis://localhost:6379';

// Recarrega o módulo limpo a cada teste (lazy)
let queuesModule;
beforeEach(() => {
  jest.resetModules();
  jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
      add: mockQueueAdd,
      getWaitingCount: mockQueueGetWaiting,
      getActiveCount: mockQueueGetActive,
      getFailedCount: mockQueueGetFailed,
      getCompletedCount: mockQueueGetCompleted,
      close: mockQueueClose,
    })),
  }));
  queuesModule = require('./index');
  jest.clearAllMocks();
});

describe('QUEUE_NAMES', () => {
  it('exporta os nomes das filas corretos', () => {
    expect(queuesModule.QUEUE_NAMES.TRANSCRIPTION).toBe('transcription');
    expect(queuesModule.QUEUE_NAMES.ANALYSIS).toBe('analysis');
    expect(queuesModule.QUEUE_NAMES.EDITOR).toBe('editor');
    expect(queuesModule.QUEUE_NAMES.UPLOAD).toBe('upload');
  });
});

describe('enqueueTranscription', () => {
  it('adiciona job na fila de transcrição com jobId idempotente', async () => {
    await queuesModule.enqueueTranscription(42);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'transcribe',
      { jobId: 42 },
      expect.objectContaining({ jobId: 'transcription-42' })
    );
  });
});

describe('enqueueAnalysis', () => {
  it('adiciona job na fila de análise com jobId idempotente', async () => {
    await queuesModule.enqueueAnalysis(7);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'analyze',
      { jobId: 7 },
      expect.objectContaining({ jobId: 'analysis-7' })
    );
  });
});

describe('enqueueClip', () => {
  it('adiciona sugestão na fila do editor com jobId idempotente', async () => {
    await queuesModule.enqueueClip(5);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'cut',
      { suggestionId: 5 },
      expect.objectContaining({ jobId: 'clip-5' })
    );
  });
});

describe('enqueueUpload', () => {
  it('adiciona upload sem delay quando scheduledAt é null', async () => {
    await queuesModule.enqueueUpload(3, null);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'upload',
      { uploadId: 3 },
      expect.objectContaining({ jobId: 'upload-3', delay: 0 })
    );
  });

  it('adiciona upload com delay para agendamento futuro', async () => {
    const futureDate = new Date(Date.now() + 60000); // 1 minuto no futuro
    await queuesModule.enqueueUpload(4, futureDate);
    const callArgs = mockQueueAdd.mock.calls[0];
    expect(callArgs[2].delay).toBeGreaterThan(0);
  });
});

describe('getQueuesStatus', () => {
  it('retorna status de todas as filas com contadores', async () => {
    mockQueueGetWaiting.mockResolvedValue(3);
    mockQueueGetActive.mockResolvedValue(1);
    mockQueueGetFailed.mockResolvedValue(0);
    mockQueueGetCompleted.mockResolvedValue(10);

    const status = await queuesModule.getQueuesStatus();

    expect(status).toHaveProperty('transcription');
    expect(status).toHaveProperty('analysis');
    expect(status).toHaveProperty('editor');
    expect(status).toHaveProperty('upload');
    expect(status.transcription.waiting).toBe(3);
    expect(status.transcription.active).toBe(1);
    expect(status.transcription.completed).toBe(10);
  });
});

describe('closeQueues', () => {
  it('fecha todas as filas sem erros', async () => {
    // Força inicialização das filas
    await queuesModule.enqueueTranscription(1);
    await expect(queuesModule.closeQueues()).resolves.toBeUndefined();
  });

  it('não lança se filas nunca foram inicializadas (double-close)', async () => {
    await queuesModule.closeQueues();
    await expect(queuesModule.closeQueues()).resolves.toBeUndefined();
  });
});

describe('connection getter', () => {
  it('retorna objeto de conexão quando REDIS_URL está configurado', () => {
    const conn = queuesModule.connection;
    expect(conn).toBeDefined();
    expect(conn.url).toBe('redis://localhost:6379');
    expect(conn.maxRetriesPerRequest).toBeNull();
  });
});
