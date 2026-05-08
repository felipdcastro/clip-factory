'use strict';

const { EventEmitter } = require('events');

jest.mock('@ffmpeg-installer/ffmpeg', () => ({ path: '/usr/bin/ffmpeg' }));
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const { spawn } = require('child_process');
const fs = require('fs');
const { generateThumbnail } = require('./thumbnail.service');

function makeProc(exitCode = 0) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  setTimeout(() => proc.emit('close', exitCode), 0);
  return proc;
}

beforeEach(() => {
  jest.resetAllMocks();
  fs.existsSync.mockReturnValue(false);
});

describe('generateThumbnail', () => {
  it('retorna caminho do cache sem chamar FFmpeg (cache hit)', async () => {
    fs.existsSync.mockReturnValue(true);

    const result = await generateThumbnail('/videos/test.mp4', 5, 'test-key');

    expect(result).toContain('thumb_test-key.jpg');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('lança erro 404 quando arquivo de vídeo não existe', async () => {
    // existsSync retorna false (default) para cache e para o vídeo
    const err = await generateThumbnail('/videos/notfound.mp4', 0, 'test-key').catch(e => e);

    expect(err.message).toBe('Arquivo de vídeo não encontrado');
    expect(err.status).toBe(404);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('gera thumbnail com FFmpeg e retorna caminho quando sucesso', async () => {
    fs.existsSync
      .mockReturnValueOnce(false)  // cache miss
      .mockReturnValueOnce(true)   // vídeo existe
      .mockReturnValueOnce(true);  // cache existe após FFmpeg

    spawn.mockReturnValue(makeProc(0));

    const result = await generateThumbnail('/videos/test.mp4', 5, 'test-key');

    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/ffmpeg',
      expect.arrayContaining(['-ss', '5', '-i', '/videos/test.mp4'])
    );
    expect(result).toContain('thumb_test-key.jpg');
  });

  it('lança erro quando FFmpeg encerra com código diferente de zero', async () => {
    fs.existsSync
      .mockReturnValueOnce(false)  // cache miss
      .mockReturnValueOnce(true);  // vídeo existe

    spawn.mockReturnValue(makeProc(1));

    const err = await generateThumbnail('/videos/test.mp4', 5, 'test-key').catch(e => e);

    expect(err.message).toMatch('FFmpeg encerrou com código 1');
  });
});
