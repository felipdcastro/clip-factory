const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { updateSuggestionStatus } = require('../modules/analyzer/analyzer.service');
const { generateYouTubeMetadata } = require('../modules/analyzer/metadata.service');
const { getSummonerByName, getSummonerRank, getRecentMatchChampion } = require('../modules/analyzer/riot.service');
const { generateThumbnail } = require('../modules/editor/thumbnail.service');
const { query } = require('../db/connection');
const logger = require('../utils/logger').child({ module: 'suggestions-route' });

const seoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Limite de análise SEO atingido. Aguarde 1 minuto (máx 5/min).' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/suggestions/:id/thumbnail — retorna thumbnail JPEG
// Usa thumbnail_offset_sec (SEO Squad) se disponível, senão usa start_time
router.get('/:id/thumbnail', async (req, res, _next) => {
  try {
    const result = await query(
      `SELECT cs.id, cs.start_time, cs.thumbnail_offset_sec, j.file_path
       FROM clip_suggestions cs
       JOIN jobs j ON j.id = cs.job_id
       WHERE cs.id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Sugestão não encontrada' });

    const { id, start_time, thumbnail_offset_sec, file_path } = result.rows[0];

    if (!file_path) return res.status(404).json({ error: 'Arquivo de vídeo não disponível' });

    const offsetSec  = thumbnail_offset_sec ? parseFloat(thumbnail_offset_sec) : 0;
    const thumbTimeSec = parseFloat(start_time) + offsetSec;
    // Cache key muda quando o offset muda — evita servir frame desatualizado
    const cacheKey   = thumbnail_offset_sec ? `${id}_${Math.round(offsetSec * 10)}` : `${id}`;

    const thumbPath = await generateThumbnail(file_path, thumbTimeSec, cacheKey);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    logger.warn({ err, suggestion_id: req.params.id }, 'Falha ao gerar thumbnail');
    res.status(500).json({ error: 'Não foi possível gerar o thumbnail' });
  }
});

// GET /api/suggestions/:id/clip — retorna o clip associado à sugestão
router.get('/:id/clip', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM clips WHERE suggestion_id=$1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Clip não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/suggestions/:id/metadata — metadados YouTube
// Prioriza dados do SEO Squad se disponíveis; fallback para geração automática
router.get('/:id/metadata', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT cs.id, cs.title, cs.reason, cs.clip_category, cs.type,
              cs.suggested_tags, cs.suggested_description,
              cs.seo_title, cs.seo_description, cs.seo_tags,
              cs.seo_score, cs.thumbnail_offset_sec,
              j.summoner_name, j.riot_region, j.content_type
       FROM clip_suggestions cs
       JOIN jobs j ON j.id = cs.job_id
       WHERE cs.id=$1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Sugestão não encontrada' });

    const row = result.rows[0];

    // SEO Squad data disponível — retorna direto sem chamada Riot
    if (row.seo_title || row.seo_description) {
      return res.json({
        title:              row.seo_title || row.title,
        description:        row.seo_description,
        tags:               Array.isArray(row.seo_tags) ? row.seo_tags : (row.seo_tags || []),
        seoScore:           row.seo_score,
        thumbnailOffsetSec: row.thumbnail_offset_sec,
        seoOptimized:       true,
      });
    }

    let riotData = null;
    if (row.summoner_name) {
      const summoner = await getSummonerByName(row.summoner_name, row.riot_region);
      if (summoner) {
        const [rankData, champion] = await Promise.all([
          getSummonerRank(summoner.encryptedId, row.riot_region),
          getRecentMatchChampion(summoner.puuid, row.riot_region),
        ]);
        riotData = { ...(rankData || {}), champion };
      }
    }

    const suggestedTags = Array.isArray(row.suggested_tags) ? row.suggested_tags : null;
    const metadata = generateYouTubeMetadata({ ...row, suggested_tags: suggestedTags }, riotData);
    res.json({ ...metadata, seoOptimized: false });
  } catch (err) {
    next(err);
  }
});

// POST /api/suggestions/:id/seo — executa o SEO Squad e salva resultados
router.post('/:id/seo', seoLimiter, async (req, res, next) => {
  try {
    const { runSEOSquad } = require('../modules/seo/seo.service');
    const result = await runSEOSquad(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/suggestions/:id — aprova ou rejeita uma sugestão
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Campo "status" é obrigatório' });

    const suggestion = await updateSuggestionStatus(req.params.id, status);

    // Se aprovada, enfileira para corte imediatamente
    if (status === 'approved') {
      const { enqueueClip } = require('../queues');
      enqueueClip(suggestion.id).catch(err => {
        const logger = require('../utils/logger').child({ module: 'suggestions-route' });
        logger.error({ err, suggestion_id: suggestion.id }, 'Falha ao enfileirar clip');
      });
    }

    res.json(suggestion);
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
