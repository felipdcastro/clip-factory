'use strict';

const { withRetry, isRetryable } = require('./retry');

describe('isRetryable', () => {
  it('retorna true para erros de rede (ECONNRESET)', () => {
    const err = new Error('connection reset');
    err.code = 'ECONNRESET';
    expect(isRetryable(err)).toBe(true);
  });

  it('retorna true para HTTP 429 (quota)', () => {
    const err = new Error('Too Many Requests');
    err.status = 429;
    expect(isRetryable(err)).toBe(true);
  });

  it('retorna true para HTTP 500', () => {
    const err = new Error('Internal Server Error');
    err.status = 500;
    expect(isRetryable(err)).toBe(true);
  });

  it('retorna false para HTTP 401 (não retriável)', () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    expect(isRetryable(err)).toBe(false);
  });

  it('retorna false para HTTP 403 (não retriável)', () => {
    const err = new Error('Forbidden');
    err.status = 403;
    expect(isRetryable(err)).toBe(false);
  });

  it('retorna false para erros genéricos sem código HTTP', () => {
    const err = new Error('algo deu errado');
    expect(isRetryable(err)).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retorna resultado na primeira tentativa se sucesso', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('faz retry em erro retriável e retorna na 2a tentativa', async () => {
    const retriableErr = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
    const fn = jest.fn()
      .mockRejectedValueOnce(retriableErr)
      .mockResolvedValueOnce('success');

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('falha imediatamente em erro não-retriável (401) sem retry', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('esgota tentativas e lança último erro', async () => {
    jest.useRealTimers();
    const err = Object.assign(new Error('Server Error'), { status: 500 });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('Server Error');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('chama onRetry com dados corretos', async () => {
    const err = Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' });
    const fn = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('done');

    const onRetry = jest.fn();
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    await jest.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      error: err,
    }));
  });
});
