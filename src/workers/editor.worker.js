const { query } = require('../db/connection');
const { processClip } = require('../modules/editor/editor.service');

const POLL_INTERVAL_MS = 15 * 1000; // 15 segundos (mais frequente — usuário acabou de aprovar)

async function runEditorWorker() {
  try {
    // Busca sugestões aprovadas que ainda não têm clip em corte ou pronto
    const result = await query(
      `SELECT cs.id
       FROM clip_suggestions cs
       LEFT JOIN clips c ON c.suggestion_id = cs.id
       WHERE cs.status = 'approved'
         AND c.id IS NULL
       ORDER BY cs.created_at ASC
       LIMIT 2`  // máx 2 por ciclo — alinhado com p-limit(2)
    );

    if (result.rows.length === 0) return;

    // Processa em paralelo (p-limit cuida do throttle interno)
    await Promise.allSettled(
      result.rows.map(row => processClip(row.id).catch(err => {
        console.error(`Editor worker — clip ${row.id} falhou:`, err.message);
      }))
    );
  } catch (err) {
    console.error('Editor worker error:', err.message);
  }
}

function startEditorWorker() {
  console.log('✂️  Editor worker iniciado (intervalo: 15s)');
  setInterval(runEditorWorker, POLL_INTERVAL_MS);
  runEditorWorker();
}

module.exports = { startEditorWorker };
