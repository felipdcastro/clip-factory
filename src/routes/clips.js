const fs     = require('fs');
const router = require('express').Router();
const { getClip } = require('../modules/editor/editor.service');
const { query } = require('../db/connection');

// GET /api/clips/by-suggestion/:suggestionId — busca clip pela sugestão
router.get('/by-suggestion/:suggestionId', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM clips WHERE suggestion_id=$1 ORDER BY created_at DESC LIMIT 1', [req.params.suggestionId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Clip não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/clips/:id/stream — streaming com suporte a HTTP Range (para player de vídeo)
router.get('/:id/stream', async (req, res, next) => {
  try {
    const clip = await getClip(req.params.id);
    if (!clip) return res.status(404).json({ error: 'Clip não encontrado' });
    if (clip.status !== 'ready') return res.status(409).json({ error: 'Clip ainda não está pronto' });
    if (!clip.file_path || !fs.existsSync(clip.file_path)) {
      return res.status(404).json({ error: 'Arquivo do clip não encontrado no disco' });
    }

    const { size: fileSize } = fs.statSync(clip.file_path);
    const mimeType = clip.file_path.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   mimeType,
      });
      fs.createReadStream(clip.file_path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type':   mimeType,
        'Accept-Ranges':  'bytes',
      });
      fs.createReadStream(clip.file_path).pipe(res);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/clips/:id — retorna status e caminho do clip
router.get('/:id', async (req, res, next) => {
  try {
    const clip = await getClip(req.params.id);
    if (!clip) return res.status(404).json({ error: 'Clip não encontrado' });
    res.json(clip);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
