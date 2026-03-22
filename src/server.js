const _dotenvResult = require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
console.log('[startup] dotenv:', _dotenvResult.error ? 'ERRO: ' + _dotenvResult.error.message : 'OK');
console.log('[startup] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'CONFIGURADA' : 'AUSENTE');
const app = require('./app');
const { testConnection } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { startTranscriptionWorker } = require('./workers/transcription.worker');
const { startAnalyzerWorker } = require('./workers/analyzer.worker');
const { startEditorWorker } = require('./workers/editor.worker');
const { startUploaderWorker } = require('./workers/uploader.worker');

const PORT = process.env.PORT || 3000;

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
    getKey(); // lança erro se TOKEN_ENCRYPTION_KEY ausente ou curta demais
    console.log('✅ TOKEN_ENCRYPTION_KEY configurada');

    // Validação de variáveis de ambiente críticas
    const missingVars = ['ASSEMBLYAI_API_KEY', 'OPENAI_API_KEY'].filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      console.warn(`⚠️  Variáveis de ambiente não configuradas: ${missingVars.join(', ')}`);
      console.warn('   Configure no arquivo .env ou nas variáveis do Railway.');
    } else {
      console.log('✅ Variáveis de ambiente OK (AssemblyAI, OpenAI)');
    }

    // Inicia workers de background
    startTranscriptionWorker();
    startAnalyzerWorker();
    startEditorWorker();
    startUploaderWorker();

    app.listen(PORT, () => {
      console.log(`🚀 Clip Factory running on http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
      console.log(`   Dashboard: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
