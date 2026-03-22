'use strict';

jest.mock('../../db/connection', () => ({ query: jest.fn() }));
jest.mock('./ffmpeg.service', () => ({
  cutClip: jest.fn().mockResolvedValue('/tmp/1_1_video.mp4'),
  buildOutputPath: jest.fn().mockReturnValue('/tmp/1_1_video.mp4'),
}));

// Exporta funções privadas via require do módulo (coverage)
// Para testar msToSrt e generateSRT precisamos chamar processClip com words reais

const { query } = require('../../db/connection');
const { cutClip } = require('./ffmpeg.service');
const { processClip } = require('./editor.service');

describe('processClip com words (SRT gerado)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('processa clip com words para geração de SRT', async () => {
    // JSONB retorna array diretamente (não string)
    const words = [
      { text: 'Olá', start: 10500, end: 11000, confidence: 0.99 },
      { text: 'mundo', start: 11100, end: 11800, confidence: 0.98 },
      { text: 'teste', start: 12000, end: 12500, confidence: 0.97 },
    ];

    query
      .mockResolvedValueOnce({
        rows: [{
          id: 1, status: 'approved', job_id: 1,
          video_path: '/tmp/job_1.mp4', type: 'video',
          start_time: '10.0', end_time: '20.0', duration_seconds: 600,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ words }] }) // SELECT words from transcriptions (string)
      .mockResolvedValueOnce({ rows: [{ id: 1, suggestion_id: 1, job_id: 1, type: 'video', status: 'cutting' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE ready

    const result = await processClip(1);
    // cutClip chamado com srtPath (pode ser null se nenhuma word cai no intervalo)
    expect(cutClip).toHaveBeenCalled();
    expect(result.status).toBe('ready');
  });

  it('processa clip sem words na faixa de tempo (srtPath=null)', async () => {
    // Words fora do intervalo do clip
    const words = [
      { text: 'antes', start: 0, end: 5000, confidence: 0.99 },
      { text: 'depois', start: 25000, end: 30000, confidence: 0.98 },
    ];

    query
      .mockResolvedValueOnce({
        rows: [{
          id: 2, status: 'approved', job_id: 1,
          video_path: '/tmp/job_1.mp4', type: 'reel',
          start_time: '10.0', end_time: '20.0', duration_seconds: 600,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ words }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, suggestion_id: 2, job_id: 1, type: 'reel', status: 'cutting' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await processClip(2);
    expect(cutClip).toHaveBeenCalledWith(
      '/tmp/job_1.mp4', 1, 2, 10.0, 20.0, 'reel', null
    );
    expect(result.status).toBe('ready');
  });
});
