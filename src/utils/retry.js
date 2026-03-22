'use strict';

// Erros HTTP retriáveis
const RETRYABLE_HTTP_CODES = new Set([429, 500, 502, 503, 504]);

// Erros de rede retriáveis
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE',
]);

// Erros HTTP não-retriáveis (falha imediata)
const NON_RETRYABLE_HTTP_CODES = new Set([400, 401, 403, 404]);

/**
 * Classifica se um erro é retriável.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryable(err) {
  // Erro de rede
  if (err.code && RETRYABLE_NETWORK_CODES.has(err.code)) return true;

  // Erro HTTP via googleapis / axios / fetch
  const statusCode =
    err.status ||
    err.response?.status ||
    err.code;

  if (typeof statusCode === 'number') {
    if (NON_RETRYABLE_HTTP_CODES.has(statusCode)) return false;
    if (RETRYABLE_HTTP_CODES.has(statusCode)) return true;
  }

  return false;
}

/**
 * Executa uma função com retry exponencial + jitter.
 *
 * @param {Function} fn - Função async a executar
 * @param {object} options
 * @param {number} options.maxAttempts - Máximo de tentativas (default: 3)
 * @param {number} options.baseDelayMs - Delay base em ms (default: 1000)
 * @param {Function} options.onRetry - Callback chamado antes de cada retry (opcional)
 * @returns {Promise<*>}
 */
async function withRetry(fn, options = {}) {
  const { maxAttempts = 3, baseDelayMs = 1000, onRetry } = options;

  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const isLastAttempt = attempt === maxAttempts;
      const retriable = isRetryable(err);

      if (isLastAttempt || !retriable) {
        throw err;
      }

      // Backoff exponencial com jitter: baseDelay * 2^(attempt-1) + random(0..1000)ms
      const backoff = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = backoff + jitter;

      if (onRetry) {
        onRetry({ attempt, error: err, nextRetryInMs: delayMs });
      }

      await sleep(delayMs);
    }
  }

  throw lastErr;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { withRetry, isRetryable };
