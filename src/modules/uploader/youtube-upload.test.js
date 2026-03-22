'use strict';

const mockVideosInsert = jest.fn();
const mockAuth = {};

jest.mock('googleapis', () => ({
  google: {
    youtube: jest.fn().mockReturnValue({
      videos: { insert: mockVideosInsert },
    }),
  },
}));

jest.mock('./youtube-auth.service', () => ({
  getAuthenticatedClient: jest.fn().mockResolvedValue(mockAuth),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 10 * 1024 * 1024 }),
  createReadStream: jest.fn().mockReturnValue('stream'),
  unlinkSync: jest.fn(),
}));

const fs = require('fs');
const { uploadToYouTube, cleanupClipFile, buildVideoMetadata } = require('./youtube-upload.service');

describe('buildVideoMetadata', () => {
  it('gera metadados para vídeo (não reel)', () => {
    const result = buildVideoMetadata('Título do Vídeo', 'Desc', 'video', null);
    expect(result.snippet.title).toBe('Título do Vídeo');
    expect(result.status.privacyStatus).toBe('public');
    expect(result.status.publishAt).toBeUndefined();
  });

  it('adiciona #Shorts ao título e descrição para reel', () => {
    const result = buildVideoMetadata('Vídeo Reel', 'Desc curta', 'reel', null);
    expect(result.snippet.title).toContain('#Shorts');
    expect(result.snippet.description).toContain('#Shorts');
  });

  it('não duplica #Shorts se já está no título', () => {
    const result = buildVideoMetadata('Título #Shorts', 'Desc', 'reel', null);
    expect(result.snippet.title).toBe('Título #Shorts');
    // Não deve ter dois #Shorts
    expect(result.snippet.title.split('#Shorts').length).toBe(2);
  });

  it('define privacyStatus=private e publishAt quando scheduledAt fornecido', () => {
    const futureDate = new Date(Date.now() + 3600000);
    const result = buildVideoMetadata('Título', 'Desc', 'video', futureDate);
    expect(result.status.privacyStatus).toBe('private');
    expect(result.status.publishAt).toBeDefined();
  });

  it('description vazia usa string vazia', () => {
    const result = buildVideoMetadata('Título', null, 'video', null);
    expect(result.snippet.description).toBe('');
  });
});

describe('uploadToYouTube', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lança se arquivo não existe', async () => {
    fs.existsSync.mockReturnValue(false);
    await expect(uploadToYouTube('/tmp/nao-existe.mp4', 'T', 'D', 'video', null))
      .rejects.toThrow('não encontrado');
  });

  it('faz upload e retorna videoId e videoUrl', async () => {
    fs.existsSync.mockReturnValue(true);
    mockVideosInsert.mockResolvedValueOnce({ data: { id: 'yt-abc123' } });

    const result = await uploadToYouTube('/tmp/clip.mp4', 'Título', 'Desc', 'video', null);
    expect(result.videoId).toBe('yt-abc123');
    expect(result.videoUrl).toContain('yt-abc123');
    expect(mockVideosInsert).toHaveBeenCalled();
  });
});

describe('cleanupClipFile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('remove arquivo existente', () => {
    fs.existsSync.mockReturnValue(true);
    cleanupClipFile('/tmp/clip.mp4');
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/clip.mp4');
  });

  it('não lança se arquivo não existe', () => {
    fs.existsSync.mockReturnValue(false);
    expect(() => cleanupClipFile('/tmp/nao-existe.mp4')).not.toThrow();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('não lança se filePath é null', () => {
    expect(() => cleanupClipFile(null)).not.toThrow();
  });

  it('não lança se unlinkSync falha (swallow error)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockImplementation(() => { throw new Error('Permission denied'); });
    expect(() => cleanupClipFile('/tmp/clip.mp4')).not.toThrow();
  });
});
