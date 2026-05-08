'use strict';

const _dotenvResult = require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const logger = require('./utils/logger').child({ module: 'server' });

logger.info(_dotenvResult.error
  ? { err: _dotenvResult.error }
  : {}, `dotenv: ${_dotenvResult.error ? 'ERRO: ' + _dotenvResult.error.message : 'OK'}`);

const app = require('./app');
const { testConnection } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { closeQueues, startQueueHealthMonitor, stopQueueHealthMonitor } = require('./queues');
const { closeRedisLock } = require('./utils/redis-lock');
const { startTranscriptionWorker, stopTranscriptionWorker } = require('./workers/transcription.worker');
const { startAnalyzerWorker, stopAnalyzerWorker } = require('./workers/analyzer.worker');
const { startEditorWorker, stopEditorWorker } = require('./workers/editor.worker');
const { startUploaderWorker, stopUploaderWorker } = require('./workers/uploader.worker');

const PORT = process.env.PORT || 3000;
let server = null;

async function start() {
  try {
    await testConnection();
    await migrate();

    // Ensure tmp dir exists
    const fs = require('fs');
    const tmpDir = process.env.TEMP_DIR || './tmp';
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Validação de TOKEN_ENCRYPTION_KEY — obrigatória, falha no startup se ausente
    const { getKey } = require('./utils/crypto');
    getKey();
    logger.info('TOKEN_ENCRYPTION_KEY configurada');

    // Validação de variáveis de ambiente críticas — falha no startup se ausentes
    const missingVars = ['ASSEMBLYAI_API_KEY', 'OPENAI_API_KEY'].filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      logger.error({ missing_vars: missingVars }, `Variáveis obrigatórias não configuradas: ${missingVars.join(', ')}. Configure no .env e reinicie.`);
      process.exit(1);
    }
    logger.info('Variáveis de ambiente OK (AssemblyAI, OpenAI)');

    // Em produção, SESSION_SECRET default é risco de segurança
    if (process.env.NODE_ENV === 'production' &&
        (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'clip-factory-secret-change-me')) {
      logger.error('SESSION_SECRET não configurada ou usa valor default inseguro. Defina uma string aleatória em .env e reinicie.');
      process.exit(1);
    }

    // Inicia workers BullMQ
    startTranscriptionWorker();
    startAnalyzerWorker();
    startEditorWorker();
    startUploaderWorker();
    startQueueHealthMonitor();

    server = app.listen(PORT, () => {
      logger.info({ port: PORT }, `Clip Factory running on http://localhost:${PORT}`);
    });

    // Graceful shutdown — finaliza jobs em andamento antes de encerrar
    async function shutdown(signal) {
      logger.info({ signal }, 'Sinal recebido — iniciando graceful shutdown');

      // Para de aceitar novas conexões
      if (server) server.close();

      const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000');

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Shutdown timeout após ${SHUTDOWN_TIMEOUT_MS}ms`)), SHUTDOWN_TIMEOUT_MS)
      );

      try {
        // Aguarda workers finalizarem jobs em andamento (com timeout)
        stopQueueHealthMonitor();
        await Promise.race([
          Promise.all([
            stopTranscriptionWorker(),
            stopAnalyzerWorker(),
            stopEditorWorker(),
            stopUploaderWorker(),
          ]),
          timeout,
        ]);
      } catch (err) {
        logger.error({ err }, 'Shutdown forçado — workers não finalizaram a tempo');
      }

      // Fecha conexões com Redis (best-effort)
      await Promise.all([closeQueues(), closeRedisLock()]).catch(() => {});

      logger.info('Shutdown concluído');
      process.exit(0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
