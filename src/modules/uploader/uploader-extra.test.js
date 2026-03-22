'use strict';

jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('./youtube-upload.service', () => ({
  uploadToYouTube: jest.fn(),
  cleanupClipFile: jest.fn(),
}));

jest.mock('./youtube-auth.service', () => ({
  isAuthenticated: jest.fn(),
}));

jest.mock('../../utils/retry', () => ({
  withRetry: jest.fn().mockImplementation(async (fn) => fn()),
}));

const { query } = require('../../db/connection');
const { uploadToYouTube, cleanupClipFile } = require('./youtube-upload.service');
const { isAuthenticated } = require('./youtube-auth.service');
const { processUpload, retryUpload, getUpload, listUploads } = require('./uploader.service');

describe('processUpload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lança se upload não encontrado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(processUpload(999)).rejects.toThrow('não encontrado');
  });

  it('lança se upload não está na fila', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'uploading', file_path: '/tmp/clip.mp4', clip_id: 1 }] });
    await expect(processUpload(1)).rejects.toThrow('não está na fila');
  });

  it('lança se clip não tem arquivo', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'queued', file_path: null, clip_id: 1 }] });
    await expect(processUpload(1)).rejects.toThrow('não tem arquivo');
  });

  it('lança se YouTube não autenticado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'queued', file_path: '/tmp/clip.mp4', clip_id: 1 }] });
    isAuthenticated.mockResolvedValueOnce(false);
    await expect(processUpload(1)).rejects.toThrow('YouTube não autorizado');
  });

  it('processa upload com sucesso (scheduled)', async () => {
    const futureDate = new Date(Date.now() + 3600000);
    const upload = {
      id: 1, status: 'queued', clip_id: 1, file_path: '/tmp/clip.mp4',
      title: 'Vídeo', description: 'Desc', clip_type: 'video',
      scheduled_at: futureDate,
    };
    query
      .mockResolvedValueOnce({ rows: [upload] })        // SELECT upload+clip
      .mockResolvedValueOnce({ rows: [] })               // UPDATE uploading
      .mockResolvedValueOnce({ rows: [] })               // UPDATE scheduled
      .mockResolvedValueOnce({ rows: [] });              // UPDATE clips file_path=NULL
    isAuthenticated.mockResolvedValueOnce(true);
    uploadToYouTube.mockResolvedValueOnce({ videoId: 'yt-123', videoUrl: 'https://yt.com/yt-123' });

    const result = await processUpload(1);
    expect(result.videoId).toBe('yt-123');
    expect(result.status).toBe('scheduled');
    expect(cleanupClipFile).toHaveBeenCalledWith('/tmp/clip.mp4');
  });

  it('processa upload sem scheduled_at (uploaded)', async () => {
    const upload = {
      id: 2, status: 'queued', clip_id: 2, file_path: '/tmp/clip2.mp4',
      title: 'Vídeo 2', description: null, clip_type: 'reel',
      scheduled_at: null,
    };
    query
      .mockResolvedValueOnce({ rows: [upload] })
      .mockResolvedValueOnce({ rows: [] })              // UPDATE uploading
      .mockResolvedValueOnce({ rows: [] })              // UPDATE uploaded
      .mockResolvedValueOnce({ rows: [] });             // UPDATE clips
    isAuthenticated.mockResolvedValueOnce(true);
    uploadToYouTube.mockResolvedValueOnce({ videoId: 'yt-456', videoUrl: 'https://yt.com/yt-456' });

    const result = await processUpload(2);
    expect(result.status).toBe('uploaded');
  });

  it('salva failure_reason e lança se uploadToYouTube falha', async () => {
    const upload = {
      id: 3, status: 'queued', clip_id: 3, file_path: '/tmp/clip3.mp4',
      title: 'Vídeo 3', description: null, clip_type: 'video', scheduled_at: null,
    };
    query
      .mockResolvedValueOnce({ rows: [upload] })
      .mockResolvedValueOnce({ rows: [] })              // UPDATE uploading
      .mockResolvedValueOnce({ rows: [] });             // UPDATE failed
    isAuthenticated.mockResolvedValueOnce(true);
    const uploadErr = Object.assign(new Error('quota exceeded'), { status: 429 });
    uploadToYouTube.mockRejectedValueOnce(uploadErr);

    const { withRetry } = require('../../utils/retry');
    withRetry.mockImplementationOnce((fn) => fn()); // sem retry, chama fn direto

    await expect(processUpload(3)).rejects.toThrow('quota exceeded');
    const lastQuery = query.mock.calls[query.mock.calls.length - 1];
    expect(lastQuery[0]).toContain("status='failed'");
    expect(lastQuery[1][0]).toContain('[429]');
  });
});

describe('retryUpload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lança 404 se upload não encontrado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const err = await retryUpload(999).catch(e => e);
    expect(err.status).toBe(404);
  });

  it('lança 400 se upload não está em failed', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'uploading' }] });
    const err = await retryUpload(1).catch(e => e);
    expect(err.status).toBe(400);
  });
});

describe('getUpload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna upload existente', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'queued' }] });
    const result = await getUpload(1);
    expect(result.id).toBe(1);
  });

  it('retorna null para upload inexistente', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getUpload(999)).toBeNull();
  });
});

describe('listUploads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna lista de uploads', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const result = await listUploads();
    expect(result).toHaveLength(2);
  });
});
