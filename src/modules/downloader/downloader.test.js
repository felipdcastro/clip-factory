// Mock do banco de dados
jest.mock('../../db/connection', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ id: 1, url: '', status: 'pending' }], rowCount: 1 }),
  pool: { query: jest.fn() },
}));

// Mock do yt-dlp-exec para não fazer downloads reais
jest.mock('yt-dlp-exec', () => jest.fn());

const { isValidYouTubeUrl } = require('./yt-dlp');

describe('isValidYouTubeUrl', () => {
  const validUrls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=abc123',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=abc123',
  ];

  const invalidUrls = [
    'https://vimeo.com/video/123',
    'https://tiktok.com/@user/video/123',
    'not-a-url',
    '',
    'javascript:alert(1)',
    'https://evil.com/youtube.com/watch?v=abc',
  ];

  validUrls.forEach(url => {
    it(`aceita URL válida: ${url}`, () => {
      expect(isValidYouTubeUrl(url)).toBe(true);
    });
  });

  invalidUrls.forEach(url => {
    it(`rejeita URL inválida: ${url || '(vazio)'}`, () => {
      expect(isValidYouTubeUrl(url)).toBe(false);
    });
  });
});

describe('createJob — validação de URL', () => {
  let createJob;

  beforeAll(() => {
    ({ createJob } = require('./job.service'));
  });

  it('rejeita URL de outro domínio', async () => {
    await expect(createJob('https://vimeo.com/video/123')).rejects.toThrow('URL inválida');
  });

  it('rejeita string vazia', async () => {
    await expect(createJob('')).rejects.toThrow('URL inválida');
  });

  it('rejeita URL maliciosa', async () => {
    await expect(createJob('javascript:alert(1)')).rejects.toThrow('URL inválida');
  });
});
