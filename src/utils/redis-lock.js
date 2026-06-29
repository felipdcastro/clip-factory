'use strict';

const Redis = require('ioredis');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL não configurado');
    const isTLS = process.env.REDIS_URL.startsWith('rediss://');
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      ...(isTLS ? { tls: { rejectUnauthorized: false } } : {}),
    });
  }
  return client;
}

/**
 * Tenta adquirir um lock distribuído via Redis SET NX PX.
 * @param {string} key  - Chave única do lock (ex: `assembly:uploadId`)
 * @param {number} ttlMs - TTL máximo do lock em ms (proteção contra crash)
 * @returns {boolean} true se o lock foi adquirido, false se já existe
 */
async function acquireLock(key, ttlMs = 5 * 60 * 1000) {
  const result = await getClient().set(key, '1', 'NX', 'PX', ttlMs);
  return result === 'OK';
}

/**
 * Libera o lock distribuído.
 */
async function releaseLock(key) {
  await getClient().del(key);
}

async function closeRedisLock() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { acquireLock, releaseLock, closeRedisLock };
