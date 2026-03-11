jest.mock('../../db/connection', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('./youtube-auth.service', () => ({
  getAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock'),
  exchangeCodeForTokens: jest.fn().mockResolvedValue({ access_token: 'tok', refresh_token: 'ref' }),
  getAuthenticatedClient: jest.fn().mockResolvedValue({}),
  isAuthenticated: jest.fn().mockResolvedValue(true),
  saveTokens: jest.fn(),
}));

jest.mock('./youtube-upload.service', () => ({
  uploadToYouTube: jest.fn().mockResolvedValue({
    videoId: 'abc123',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
  }),
  cleanupClipFile: jest.fn(),
  buildVideoMetadata: jest.requireActual('./youtube-upload.service').buildVideoMetadata,
}));

const { query } = require('../../db/connection');
const { uploadToYouTube, cleanupClipFile } = require('./youtube-upload.service');
const { processUpload } = require('./uploader.service');
const { buildVideoMetadata } = require('./youtube-upload.service');

describe('buildVideoMetadata', () => {
  it('adiciona #Shorts ao título para reels', () => {
    const meta = buildVideoMetadata('MBL fala sobre impostos', '', 'reel', null);
    expect(meta.snippet.title).toContain('#Shorts');
    expect(meta.snippet.description).toContain('#Shorts');
  });

  it('não adiciona #Shorts para vídeos normais', () => {
    const meta = buildVideoMetadata('MBL fala sobre impostos', '', 'video', null);
    expect(meta.snippet.title).not.toContain('#Shorts');
  });

  it('não duplica #Shorts se já presente no título', () => {
    const meta = buildVideoMetadata('Título #Shorts', '', 'reel', null);
    expect(meta.snippet.title.split('#Shorts').length - 1).toBe(1);
  });

  it('define privacidade private quando há scheduled_at', () => {
    const meta = buildVideoMetadata('Título', '', 'video', '2026-03-15T10:00:00Z');
    expect(meta.status.privacyStatus).toBe('private');
    expect(meta.status.publishAt).toBeDefined();
  });

  it('define privacidade public quando não há agendamento', () => {
    const meta = buildVideoMetadata('Título', '', 'video', null);
    expect(meta.status.privacyStatus).toBe('public');
  });

  it('categoria é 25 (News & Politics)', () => {
    const meta = buildVideoMetadata('T', '', 'video', null);
    expect(meta.snippet.categoryId).toBe('25');
  });
});

describe('processUpload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falha se upload não encontrado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(processUpload(999)).rejects.toThrow('não encontrado');
  });

  it('falha se upload não está na fila', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, status: 'uploading', clip_id: 1, file_path: '/tmp/v.mp4', clip_type: 'video' }],
    });
    await expect(processUpload(1)).rejects.toThrow('não está na fila');
  });

  it('processa upload com sucesso e limpa arquivo', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'queued', clip_id: 1, file_path: '/tmp/v.mp4', clip_type: 'video', title: 'Teste', description: '', scheduled_at: null }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE uploading
      .mockResolvedValueOnce({ rows: [] }) // UPDATE uploaded
      .mockResolvedValueOnce({ rows: [] }); // UPDATE clips file_path

    const result = await processUpload(1);
    expect(result.videoId).toBe('abc123');
    expect(result.videoUrl).toContain('youtube.com');
    expect(cleanupClipFile).toHaveBeenCalledWith('/tmp/v.mp4');
  });

  it('marca como failed e re-lança erro se upload falhar', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 2, status: 'queued', clip_id: 1, file_path: '/tmp/v.mp4', clip_type: 'video', title: 'T', description: '', scheduled_at: null }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE uploading
      .mockResolvedValueOnce({ rows: [] }); // UPDATE failed

    uploadToYouTube.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(processUpload(2)).rejects.toThrow('quota exceeded');

    const lastCall = query.mock.calls[query.mock.calls.length - 1];
    expect(lastCall[0]).toContain("status='failed'");
  });
});
