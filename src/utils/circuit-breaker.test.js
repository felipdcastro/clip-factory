'use strict';

const { CircuitBreaker, STATES } = require('./circuit-breaker');

function makeMockRedis() {
  const store = {};
  return {
    get: jest.fn(key => Promise.resolve(store[key] ?? null)),
    set: jest.fn((key, value) => { store[key] = value; return Promise.resolve('OK'); }),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    _store: store,
  };
}

describe('CircuitBreaker', () => {
  let redis;
  let cb;

  beforeEach(() => {
    redis = makeMockRedis();
    cb = new CircuitBreaker({ redis, failureThreshold: 3, openDurationMs: 5000 });
  });

  describe('estado inicial', () => {
    it('começa em CLOSED com failureCount 0', async () => {
      const state = await cb.getState();
      expect(state).toBe(STATES.CLOSED);
    });
  });

  describe('CLOSED → OPEN', () => {
    it('permanece CLOSED antes de atingir o threshold', async () => {
      await cb.recordFailure();
      await cb.recordFailure();
      expect(await cb.getState()).toBe(STATES.CLOSED);
    });

    it('abre o circuit após atingir o threshold de falhas', async () => {
      await cb.recordFailure();
      await cb.recordFailure();
      await cb.recordFailure();
      expect(await cb.getState()).toBe(STATES.OPEN);
    });

    it('ignora falhas adicionais quando já OPEN', async () => {
      await cb.recordFailure();
      await cb.recordFailure();
      await cb.recordFailure(); // OPEN
      const writeCallsAtOpen = redis.set.mock.calls.length;
      await cb.recordFailure(); // deve ser ignorado
      expect(redis.set.mock.calls.length).toBe(writeCallsAtOpen); // nenhuma escrita extra
    });
  });

  describe('OPEN → HALF_OPEN', () => {
    it('transiciona para HALF_OPEN após openDurationMs', async () => {
      // Abre o circuit breaker
      await cb.recordFailure();
      await cb.recordFailure();
      await cb.recordFailure(); // OPEN

      // Simula timeout expirado escrevendo openedAt no passado
      const expired = JSON.stringify({ state: STATES.OPEN, failureCount: 3, openedAt: Date.now() - 10000 });
      redis._store[cb.redisKey] = expired;

      const state = await cb.getState();
      expect(state).toBe(STATES.HALF_OPEN);
    });

    it('permanece OPEN se o timeout ainda não expirou', async () => {
      const notExpired = JSON.stringify({ state: STATES.OPEN, failureCount: 3, openedAt: Date.now() });
      redis._store[cb.redisKey] = notExpired;
      expect(await cb.getState()).toBe(STATES.OPEN);
    });
  });

  describe('HALF_OPEN → CLOSED (sucesso)', () => {
    it('fecha o circuit após sucesso em HALF_OPEN', async () => {
      redis._store[cb.redisKey] = JSON.stringify({ state: STATES.HALF_OPEN, failureCount: 3, openedAt: Date.now() - 10000 });
      await cb.recordSuccess();
      expect(await cb.getState()).toBe(STATES.CLOSED);
    });

    it('reseta o failureCount ao fechar', async () => {
      redis._store[cb.redisKey] = JSON.stringify({ state: STATES.HALF_OPEN, failureCount: 5, openedAt: null });
      await cb.recordSuccess();
      const stored = JSON.parse(redis._store[cb.redisKey]);
      expect(stored.failureCount).toBe(0);
    });
  });

  describe('HALF_OPEN → OPEN (falha)', () => {
    it('reabre o circuit após falha em HALF_OPEN', async () => {
      redis._store[cb.redisKey] = JSON.stringify({ state: STATES.HALF_OPEN, failureCount: 3, openedAt: null });
      await cb.recordFailure();
      expect(await cb.getState()).toBe(STATES.OPEN);
    });

    it('reinicia o timer ao reabrir', async () => {
      const before = Date.now();
      redis._store[cb.redisKey] = JSON.stringify({ state: STATES.HALF_OPEN, failureCount: 3, openedAt: null });
      await cb.recordFailure();
      const stored = JSON.parse(redis._store[cb.redisKey]);
      expect(stored.openedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('recordSuccess em CLOSED', () => {
    it('reseta failureCount em CLOSED se havia falhas anteriores', async () => {
      redis._store[cb.redisKey] = JSON.stringify({ state: STATES.CLOSED, failureCount: 2, openedAt: null });
      await cb.recordSuccess();
      const stored = JSON.parse(redis._store[cb.redisKey]);
      expect(stored.failureCount).toBe(0);
    });

    it('não escreve se failureCount já é 0', async () => {
      const before = redis.set.mock.calls.length;
      await cb.recordSuccess(); // estado padrão CLOSED, failureCount 0
      expect(redis.set.mock.calls.length).toBe(before);
    });
  });

  describe('reset', () => {
    it('reseta para estado inicial CLOSED', async () => {
      await cb.recordFailure();
      await cb.recordFailure();
      await cb.recordFailure(); // OPEN
      await cb.reset();
      expect(await cb.getState()).toBe(STATES.CLOSED);
    });
  });

  describe('graceful degradation (Redis indisponível)', () => {
    it('retorna CLOSED se Redis lança erro no get', async () => {
      redis.get.mockRejectedValueOnce(new Error('Redis connection refused'));
      const state = await cb.getState();
      expect(state).toBe(STATES.CLOSED);
    });

    it('não lança erro se Redis lança erro no set', async () => {
      redis.set.mockRejectedValueOnce(new Error('Redis connection refused'));
      await expect(cb.recordFailure()).resolves.not.toThrow();
    });

    it('opera sem Redis (client null)', async () => {
      const cbNoRedis = new CircuitBreaker({ redis: null, failureThreshold: 3 });
      // Override _client to return null
      cbNoRedis._client = () => null;
      expect(await cbNoRedis.getState()).toBe(STATES.CLOSED);
      await expect(cbNoRedis.recordFailure()).resolves.not.toThrow();
      await expect(cbNoRedis.recordSuccess()).resolves.not.toThrow();
    });
  });

  describe('configuração via opções', () => {
    it('respeita failureThreshold customizado', async () => {
      const cbCustom = new CircuitBreaker({ redis, failureThreshold: 2 });
      await cbCustom.recordFailure();
      expect(await cbCustom.getState()).toBe(STATES.CLOSED);
      await cbCustom.recordFailure();
      expect(await cbCustom.getState()).toBe(STATES.OPEN);
    });
  });
});
