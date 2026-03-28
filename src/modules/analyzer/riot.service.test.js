'use strict';

const https = require('https');

jest.mock('https');

const { getSummonerByName, getSummonerRank, getRecentMatchChampion } = require('./riot.service');

// Helper para simular resposta HTTP
function mockHttpGet(statusCode, body) {
  const mockReq = { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
  const mockRes = {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(typeof body === 'string' ? body : JSON.stringify(body));
      if (event === 'end') cb();
      return mockRes;
    }),
  };
  https.get.mockImplementation((opts, cb) => {
    cb(mockRes);
    return mockReq;
  });
}

function mockHttpError() {
  const mockReq = {
    on: jest.fn((event, cb) => {
      if (event === 'error') cb(new Error('network error'));
      return mockReq;
    }),
    destroy: jest.fn(),
  };
  https.get.mockImplementation(() => mockReq);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RIOT_API_KEY = 'test-key';
});

afterAll(() => {
  delete process.env.RIOT_API_KEY;
});

describe('getSummonerByName', () => {
  it('retorna objeto quando API responde 200', async () => {
    mockHttpGet(200, { id: 'enc123', puuid: 'puuid-abc', name: 'Faker' });
    const result = await getSummonerByName('Faker', 'KR');
    expect(result).toEqual({ encryptedId: 'enc123', puuid: 'puuid-abc', name: 'Faker' });
  });

  it('retorna null quando API responde 404', async () => {
    mockHttpGet(404, { status: { message: 'Not Found' } });
    const result = await getSummonerByName('Inexistente', 'BR1');
    expect(result).toBeNull();
  });

  it('retorna null quando RIOT_API_KEY ausente', async () => {
    process.env.RIOT_API_KEY = '';
    const result = await getSummonerByName('Faker', 'KR');
    expect(result).toBeNull();
    expect(https.get).not.toHaveBeenCalled();
  });

  it('retorna null quando ocorre erro de rede', async () => {
    mockHttpError();
    const result = await getSummonerByName('Faker', 'KR');
    expect(result).toBeNull();
  });
});

describe('getSummonerRank', () => {
  it('retorna rank Solo/Duo quando presente', async () => {
    mockHttpGet(200, [
      { queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', rank: 'II', leaguePoints: 75 },
      { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I', leaguePoints: 50 },
    ]);
    const result = await getSummonerRank('enc123', 'BR1');
    expect(result).toEqual({ queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', rank: 'II', leaguePoints: 75 });
  });

  it('retorna null quando não há entrada ranked', async () => {
    mockHttpGet(200, [
      { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I', leaguePoints: 50 },
    ]);
    const result = await getSummonerRank('enc123', 'BR1');
    expect(result).toBeNull();
  });

  it('retorna null quando encryptedId ausente', async () => {
    const result = await getSummonerRank(null, 'BR1');
    expect(result).toBeNull();
    expect(https.get).not.toHaveBeenCalled();
  });
});

describe('getRecentMatchChampion', () => {
  it('retorna nome do campeão da partida mais recente', async () => {
    https.get
      .mockImplementationOnce((opts, cb) => {
        const res = {
          statusCode: 200,
          on: jest.fn((ev, fn) => {
            if (ev === 'data') fn(JSON.stringify(['BR1_1234']));
            if (ev === 'end') fn();
            return res;
          }),
        };
        cb(res);
        return { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
      })
      .mockImplementationOnce((opts, cb) => {
        const res = {
          statusCode: 200,
          on: jest.fn((ev, fn) => {
            if (ev === 'data') fn(JSON.stringify({
              info: {
                participants: [
                  { puuid: 'puuid-abc', championName: 'Azir' },
                  { puuid: 'other', championName: 'Jinx' },
                ],
              },
            }));
            if (ev === 'end') fn();
            return res;
          }),
        };
        cb(res);
        return { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
      });

    const result = await getRecentMatchChampion('puuid-abc', 'KR');
    expect(result).toBe('Azir');
  });

  it('retorna null quando não há partidas recentes', async () => {
    mockHttpGet(200, []);
    const result = await getRecentMatchChampion('puuid-abc', 'BR1');
    expect(result).toBeNull();
  });

  it('retorna null quando puuid ausente', async () => {
    const result = await getRecentMatchChampion(null, 'BR1');
    expect(result).toBeNull();
    expect(https.get).not.toHaveBeenCalled();
  });
});
