'use strict';

const fs   = require('fs');
const path = require('path');
const { query } = require('../db/connection');
const logger = require('./logger').child({ module: 'tmp-cleanup' });

const TEMP_DIR     = path.resolve(process.env.TEMP_DIR || './tmp');
const MAX_AGE_DAYS = parseInt(process.env.TMP_MAX_AGE_DAYS || '3');

let cleanupInterval = null;

/**
 * Remove arquivos do tmp/ que:
 * 1. Têm mais de MAX_AGE_DAYS dias, E
 * 2. Não são referenciados por nenhum clip ou job ativo no banco
 */
async function runCleanup() {
  if (!fs.existsSync(TEMP_DIR)) return;

  // Busca todos os file_paths ativos no banco
  const [clips, jobs] = await Promise.all([
    query(`SELECT file_path FROM clips WHERE file_path IS NOT NULL AND status IN ('ready','cutting')`),
    query(`SELECT file_path FROM jobs  WHERE file_path IS NOT NULL AND status NOT IN ('failed','analyzed')`),
  ]);

  const activePaths = new Set([
    ...clips.rows.map(r => path.resolve(r.file_path)),
    ...jobs.rows.map(r => path.resolve(r.file_path)),
  ]);

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files  = fs.readdirSync(TEMP_DIR);

  let deleted = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const file of files) {
    const fullPath = path.join(TEMP_DIR, file);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs > cutoff) { skipped++; continue; }
      if (activePaths.has(fullPath)) { skipped++; continue; }

      totalBytes += stat.size;
      fs.unlinkSync(fullPath);
      deleted++;
    } catch (err) {
      logger.warn({ err, file }, 'Falha ao deletar arquivo temporário');
    }
  }

  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  if (deleted > 0) {
    logger.info({ deleted, skipped, freed_mb: mb }, `Cleanup tmp/: ${deleted} arquivo(s) removidos, ${mb} MB liberados`);
  }
}

function startCleanup() {
  // Roda 1h após inicialização e depois a cada 24h
  const firstRun = setTimeout(() => {
    runCleanup().catch(err => logger.error({ err }, 'Erro no cleanup de tmp'));
  }, 60 * 60 * 1000);

  cleanupInterval = setInterval(() => {
    runCleanup().catch(err => logger.error({ err }, 'Erro no cleanup de tmp'));
  }, 24 * 60 * 60 * 1000);

  // Evita que o timer impeça o processo de encerrar
  firstRun.unref();
  cleanupInterval.unref();

  logger.info({ max_age_days: MAX_AGE_DAYS }, 'Tmp cleanup agendado (a cada 24h)');
}

function stopCleanup() {
  if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
}

module.exports = { startCleanup, stopCleanup, runCleanup };
