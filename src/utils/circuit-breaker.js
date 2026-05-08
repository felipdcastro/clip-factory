'use strict';

const Redis = require('ioredis');
const logger = require('./logger').child({ module: 'circuit-breaker' });

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

const REDIS_KEY = 'clip-factory:circuit-breaker:uploader';

const DEFAULT_STATE = { state: STATES.CLOSED, failureCount: 0, openedAt: null };

let sharedRedisClient = null;

function getSharedClient() {
  if (!sharedRedisClient) {
    if (!process.env.REDIS_URL) return null;
    sharedRedisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    sharedRedisClient.on('error', () => {}); // graceful degradation
  }
  return sharedRedisClient;
}

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = parseInt(
      options.failureThreshold ?? process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? '5'
    );
    this.openDurationMs = parseInt(
      options.openDurationMs ?? process.env.CIRCUIT_BREAKER_OPEN_DURATION_MS ?? '300000'
    );
    this.redisKey = options.redisKey ?? REDIS_KEY;
    this._redisOverride = options.redis ?? null; // injeção para testes
  }

  _client() {
    return this._redisOverride ?? getSharedClient();
  }

  async _read() {
    try {
      const client = this._client();
      if (!client) return { ...DEFAULT_STATE };
      const raw = await client.get(this.redisKey);
      return raw ? JSON.parse(raw) : { ...DEFAULT_STATE };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async _write(data) {
    try {
      const client = this._client();
      if (!client) return;
      await client.set(this.redisKey, JSON.stringify(data));
    } catch {
      // graceful degradation — opera sem persistência se Redis indisponível
    }
  }

  async getState() {
    const data = await this._read();

    if (data.state === STATES.OPEN && data.openedAt) {
      const elapsed = Date.now() - data.openedAt;
      if (elapsed >= this.openDurationMs) {
        await this._write({ ...data, state: STATES.HALF_OPEN });
        logger.info(
          { previous: STATES.OPEN, next: STATES.HALF_OPEN, elapsed_ms: elapsed },
          'Circuit breaker: OPEN → HALF_OPEN (timeout expirado, testando recuperação)'
        );
        return STATES.HALF_OPEN;
      }
    }

    return data.state;
  }

  async recordSuccess() {
    const data = await this._read();
    const previous = data.state;

    if (previous === STATES.HALF_OPEN) {
      await this._write({ state: STATES.CLOSED, failureCount: 0, openedAt: null });
      logger.info(
        { previous, next: STATES.CLOSED },
        'Circuit breaker: HALF_OPEN → CLOSED (recuperação confirmada)'
      );
    } else if (previous === STATES.CLOSED && data.failureCount > 0) {
      await this._write({ ...data, failureCount: 0 });
    }
  }

  async recordFailure() {
    const data = await this._read();
    const previous = data.state;

    if (previous === STATES.HALF_OPEN) {
      const next = { state: STATES.OPEN, failureCount: data.failureCount + 1, openedAt: Date.now() };
      await this._write(next);
      logger.warn(
        { previous, next: STATES.OPEN, failure_count: next.failureCount },
        'Circuit breaker: HALF_OPEN → OPEN (teste falhou, reabrindo)'
      );
      return;
    }

    if (previous === STATES.OPEN) return; // já aberto, nada a fazer

    const newCount = data.failureCount + 1;
    if (newCount >= this.failureThreshold) {
      await this._write({ state: STATES.OPEN, failureCount: newCount, openedAt: Date.now() });
      logger.error(
        { previous: STATES.CLOSED, next: STATES.OPEN, failure_count: newCount, threshold: this.failureThreshold },
        `Circuit breaker: CLOSED → OPEN (${newCount} falhas consecutivas, threshold: ${this.failureThreshold})`
      );
    } else {
      await this._write({ ...data, failureCount: newCount });
      logger.warn(
        { state: STATES.CLOSED, failure_count: newCount, threshold: this.failureThreshold },
        `Circuit breaker: falha registrada (${newCount}/${this.failureThreshold})`
      );
    }
  }

  async reset() {
    await this._write({ ...DEFAULT_STATE });
    logger.info({ state: STATES.CLOSED }, 'Circuit breaker: reset manual para CLOSED');
  }
}

let instance = null;

function getCircuitBreaker(options) {
  if (!instance) instance = new CircuitBreaker(options);
  return instance;
}

async function closeCircuitBreaker() {
  if (sharedRedisClient) {
    await sharedRedisClient.quit();
    sharedRedisClient = null;
  }
  instance = null;
}

module.exports = { CircuitBreaker, getCircuitBreaker, closeCircuitBreaker, STATES };
