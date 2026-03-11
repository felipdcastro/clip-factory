require('dotenv').config();
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
