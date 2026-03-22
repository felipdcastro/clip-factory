'use strict';

const _dotenvResult = require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const logger = require('./utils/logger').child({ module: 'server' });

logger.info(_dotenvResult.error
  ? { err: _dotenvResult.error }
  : {}, `dotenv: ${_dotenvResult.error ? 'ERRO: ' + _dotenvResult.error.message : 'OK'}`);

const app = require('./app');
const { testConnection } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { closeQueues } = require('./queues');
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

    // Validação de variáveis de ambiente críticas
    const missingVars = ['ASSEMBLYAI_API_KEY', 'OPENAI_API_KEY'].filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      logger.warn({ missing_vars: missingVars }, `Variáveis de ambiente não configuradas: ${missingVars.join(', ')}`);
    } else {
      logger.info('Variáveis de ambiente OK (AssemblyAI, OpenAI)');
    }

    // Inicia workers BullMQ
    startTranscriptionWorker();
    startAnalyzerWorker();
    startEditorWorker();
    startUploaderWorker();

    server = app.listen(PORT, () => {
      logger.info({ port: PORT }, `Clip Factory running on http://localhost:${PORT}`);
    });

    // Graceful shutdown — finaliza jobs em andamento antes de encerrar
    async function shutdown(signal) {
      logger.info({ signal }, 'Sinal recebido — iniciando graceful shutdown');

      // Para de aceitar novas conexões
      if (server) server.close();

      // Aguarda workers finalizarem jobs em andamento
      await Promise.all([
        stopTranscriptionWorker(),
        stopAnalyzerWorker(),
        stopEditorWorker(),
        stopUploaderWorker(),
      ]);

      // Fecha conexões com Redis
      await closeQueues();

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
