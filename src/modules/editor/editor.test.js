jest.mock('../../db/connection', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('./ffmpeg.service', () => ({
  cutClip: jest.fn().mockResolvedValue('/tmp/1_1_video.mp4'),
  buildOutputPath: jest.fn().mockReturnValue('/tmp/1_1_video.mp4'),
}));

jest.mock('./face-detector', () => ({
  detectFaceCropOffset: jest.fn().mockResolvedValue(0.5),
}));

const { query } = require('../../db/connection');
const { cutClip } = require('./ffmpeg.service');
const { processClip, getClip } = require('./editor.service');

describe('processClip', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falha se sugestão não existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(processClip(999)).rejects.toThrow('não encontrada');
  });

  it('falha se sugestão não está aprovada', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, status: 'pending', job_id: 1, video_path: '/tmp/v.mp4', type: 'video' }],
    });
    await expect(processClip(1)).rejects.toThrow('não está aprovada');
  });

  it('falha se job não tem arquivo de vídeo', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, status: 'approved', job_id: 1, video_path: null, type: 'video' }],
    });
    await expect(processClip(1)).rejects.toThrow('não tem arquivo de vídeo');
  });

  it('processa clip com sucesso e retorna ready', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 1, status: 'approved', job_id: 1,
          video_path: '/tmp/job_1.mp4', type: 'video',
          start_time: '10.0', end_time: '130.0', duration_seconds: 600,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // SELECT words from transcriptions
      .mockResolvedValueOnce({ rows: [{ id: 1, suggestion_id: 1, job_id: 1, type: 'video', status: 'cutting' }] }) // INSERT clip
      .mockResolvedValueOnce({ rows: [] }); // UPDATE ready

    const result = await processClip(1);
    expect(cutClip).toHaveBeenCalledWith('/tmp/job_1.mp4', 1, 1, 10.0, 130.0, 'video', null, 0.5);
    expect(result.status).toBe('ready');
    expect(result.file_path).toBe('/tmp/1_1_video.mp4');
  });

  it('marca clip como failed se FFmpeg falhar', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 2, status: 'approved', job_id: 1,
          video_path: '/tmp/job_1.mp4', type: 'reel',
          start_time: '50.0', end_time: '80.0', duration_seconds: 600,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // SELECT words from transcriptions
      .mockResolvedValueOnce({ rows: [{ id: 2, suggestion_id: 2, job_id: 1, type: 'reel', status: 'cutting' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE failed

    const { detectFaceCropOffset } = require('./face-detector');
    detectFaceCropOffset.mockResolvedValueOnce(0.5);
    cutClip.mockRejectedValueOnce(new Error('FFmpeg crashed'));
    await expect(processClip(2)).rejects.toThrow('FFmpeg crashed');

    // Verifica que UPDATE failed foi chamado
    const lastCall = query.mock.calls[query.mock.calls.length - 1];
    expect(lastCall[0]).toContain("status='failed'");
  });
});

describe('getClip', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna null se não encontrado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getClip(999)).toBeNull();
  });

  it('retorna clip existente', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'ready', file_path: '/tmp/1_1_video.mp4' }] });
    const clip = await getClip(1);
    expect(clip.status).toBe('ready');
    expect(clip.file_path).toBe('/tmp/1_1_video.mp4');
  });
});
