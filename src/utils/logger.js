'use strict';

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  // Redact campos sensíveis
  redact: {
    paths: [
      '*.token', '*.access_token', '*.refresh_token',
      '*.key', '*.api_key', '*.secret', '*.password',
      'authorization', 'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },

  // Serializers padrão
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Formato legível em dev, JSON puro em produção
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
});

module.exports = logger;
