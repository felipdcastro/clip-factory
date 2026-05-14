'use strict';

require('dotenv').config();
const { query } = require('./src/db/connection');
const { runSEOSquad } = require('./src/modules/seo/seo.service');

async function main() {
  const { rows: pending } = await query(`
    SELECT c.id AS clip_id, c.suggestion_id
    FROM clips c
    LEFT JOIN uploads u ON u.clip_id = c.id
    INNER JOIN clip_suggestions cs ON cs.id = c.suggestion_id
    WHERE c.status = 'ready'
      AND u.id IS NULL
      AND cs.seo_title IS NULL
    ORDER BY c.created_at ASC
  `);

  if (!pending.length) {
    console.log('Nenhum clip pendente de SEO.');
    process.exit(0);
  }

  console.log(`${pending.length} clips sem SEO. Iniciando...\n`);

  let ok = 0;
  let err = 0;

  for (const [i, clip] of pending.entries()) {
    const prefix = `[${i + 1}/${pending.length}] clip ${clip.clip_id} (suggestion ${clip.suggestion_id})`;
    try {
      const result = await runSEOSquad(clip.suggestion_id);
      console.log(`  ✅ ${prefix} — score ${result.seoScore} — "${result.seoTitle}"`);
      ok++;
    } catch (e) {
      console.error(`  ❌ ${prefix} — ${e.message}`);
      err++;
    }
  }

  console.log(`\nPronto: ${ok} com SEO, ${err} com erro.`);
  process.exit(0);
}

main().catch(e => {
  console.error('Erro fatal:', e.message);
  process.exit(1);
});
