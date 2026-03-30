'use strict';

jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('./yt-dlp', () => ({
  isValidYouTubeUrl: jest.fn(),
  getVideoMetadata: jest.fn(),
  downloadVideo: jest.fn(),
  MAX_DURATION_SECONDS: 10800, // 3 horas
}));

jest.mock('../../queues', () => ({
  enqueueTranscription: jest.fn().mockResolvedValue(undefined),
  enqueueAnalysis: jest.fn().mockResolvedValue(undefined),
  enqueueClip: jest.fn().mockResolvedValue(undefined),
  enqueueUpload: jest.fn().mockResolvedValue(undefined),
}));

const { query } = require('../../db/connection');
const { isValidYouTubeUrl, getVideoMetadata, downloadVideo } = require('./yt-dlp');
const { enqueueTranscription } = require('../../queues');
const { createJob, createJobFromFile, getJob, listJobs } = require('./job.service');

const VALID_URL = 'https://youtube.com/watch?v=dQw4w9WgXcQ';

describe('createJob', () => {
  beforeEach(() => jest.resetAllMocks());

  it('lança 400 para URL inválida', async () => {
    isValidYouTubeUrl.mockReturnValue(false);
    await expect(createJob('https://invalid.com')).rejects.toThrow('URL inválida');
    const err = await createJob('https://invalid.com').catch(e => e);
    expect(err.status).toBe(400);
  });

  it('cria job no banco e retorna o job', async () => {
    isValidYouTubeUrl.mockReturnValue(true);
    const mockJob = { id: 1, url: VALID_URL, status: 'pending' };
    query.mockResolvedValue({ rows: [mockJob] });
    getVideoMetadata.mockResolvedValue({ title: 'Video', duration_seconds: 600, thumbnail_url: null, channel_name: 'Test' });
    downloadVideo.mockResolvedValue('/tmp/job_1.mp4');

    const result = await createJob(VALID_URL);
    expect(result.id).toBe(1);
    expect(result.url).toBe(VALID_URL);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      [VALID_URL, 'pending', 'mbl', null, 'BR1']
    );
  });
});

describe('createJobFromFile', () => {
  beforeEach(() => jest.resetAllMocks());

  it('cria job com arquivo enviado e enfileira transcrição', async () => {
    const mockJob = { id: 2, status: 'downloaded', file_path: '/tmp/video.mp4' };
    query.mockResolvedValue({ rows: [mockJob] });

    const result = await createJobFromFile('/tmp/video.mp4', 'meu-video.mp4');
    expect(result.id).toBe(2);
    expect(result.status).toBe('downloaded');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      expect.arrayContaining(['file://meu-video.mp4', 'meu-video'])
    );
    expect(enqueueTranscription).toHaveBeenCalledWith(2);
  });
});

describe('getJob', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna job existente', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, status: 'downloaded' }] });
    const result = await getJob(1);
    expect(result.id).toBe(1);
    expect(result.status).toBe('downloaded');
  });

  it('retorna null para job inexistente', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await getJob(999);
    expect(result).toBeNull();
  });
});

describe('listJobs', () => {
  beforeEach(() => jest.resetAllMocks());

  it('retorna lista de jobs em ordem decrescente', async () => {
    const mockJobs = [
      { id: 3, status: 'analyzed' },
      { id: 2, status: 'downloaded' },
      { id: 1, status: 'pending' },
    ];
    query.mockResolvedValue({ rows: mockJobs });
    const result = await listJobs();
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe(3);
  });

  it('retorna array vazio quando não há jobs', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await listJobs();
    expect(result).toEqual([]);
  });
});
