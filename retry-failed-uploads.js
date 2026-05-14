'use strict';

require('dotenv').config();
const { query } = require('./src/db/connection');
const { isAuthenticated } = require('./src/modules/uploader/youtube-auth.service');
const { enqueueUpload, removeUploadJob } = require('./src/queues');

async function retryAllFailed() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    console.error('❌ YouTube não autenticado. Acesse http://localhost:3000/auth/youtube primeiro.');
    process.exit(1);
  }
  console.log('✅ YouTube autenticado\n');

  const { rows: failed } = await query(
    "SELECT id, title FROM uploads WHERE status='failed' ORDER BY id"
  );

  if (!failed.length) {
    console.log('Nenhum upload com status failed encontrado.');
    process.exit(0);
  }

  console.log(`Encontrados ${failed.length} uploads para retry:\n`);

  let ok = 0;
  let err = 0;

  for (const upload of failed) {
    try {
      await removeUploadJob(upload.id);
      await query(
        "UPDATE uploads SET status='queued', retry_count=retry_count+1, failure_reason=NULL WHERE id=$1",
        [upload.id]
      );
      await enqueueUpload(upload.id);
      console.log(`  ✅ [${upload.id}] ${upload.title}`);
      ok++;
    } catch (e) {
      console.error(`  ❌ [${upload.id}] ${upload.title} — ${e.message}`);
      err++;
    }
  }

  console.log(`\nPronto: ${ok} enfileirados, ${err} com erro.`);
  console.log('Os uploads vão processar automaticamente em background.');
  process.exit(0);
}

retryAllFailed().catch(e => {
  console.error('Erro fatal:', e.message);
  process.exit(1);
});
