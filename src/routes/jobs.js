const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { createJob, createJobFromFile, getJob, listJobs } = require('../modules/downloader/job.service');
const { getTranscription } = require('../modules/transcriber/transcription.service');
const { getSuggestions } = require('../modules/analyzer/analyzer.service');
const { acquireLock, releaseLock } = require('../utils/redis-lock');
const { query } = require('../db/connection');
const { enqueueClip, enqueueAnalysis } = require('../queues');
const logger = require('../utils/logger').child({ module: 'jobs-route' });

const jobCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Limite de criação de jobs atingido. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const TEMP_DIR = process.env.TEMP_DIR || './tmp';
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Valida que uploadId não contém path traversal
const SAFE_UPLOAD_ID = /^[a-zA-Z0-9_-]+$/;

const storage = multer.diskStorage({
  destination: TEMP_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `upload_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo são permitidos'));
    }
  },
});

// Multer para chunks (aceita qualquer tipo — chunk é binário)
const chunkUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB por chunk
});

// POST /api/jobs — cria job e inicia download em background
router.post('/', jobCreateLimiter, async (req, res, next) => {
  try {
    const { url, content_type, summoner_name, riot_region } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Campo "url" é obrigatório' });
    }

    const job = await createJob(url.trim(), content_type, summoner_name, riot_region);
    res.status(201).json(job);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/jobs/upload — cria job a partir de arquivo de vídeo (arquivo único)
router.post('/upload', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de vídeo é obrigatório' });
    }
    const job = await createJobFromFile(req.file.path, req.file.originalname, req.body.content_type);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/upload-chunk — recebe chunks e monta arquivo final
router.post('/upload-chunk', chunkUpload.single('chunk'), async (req, res, next) => {
  const multerFilePath = req.file?.path;
  try {
    const { uploadId, chunkIndex, totalChunks, fileName, content_type, summoner_name, riot_region } = req.body;
    if (!req.file || !uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
      return res.status(400).json({ error: 'Dados do chunk inválidos' });
    }

    // Sanitiza uploadId para prevenir path traversal
    if (!SAFE_UPLOAD_ID.test(uploadId)) {
      return res.status(400).json({ error: 'uploadId inválido' });
    }

    const ext = path.extname(fileName).toLowerCase();
    const allowed = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
    if (!allowed.includes(ext)) {
      return res.status(400).json({ error: 'Tipo de arquivo não permitido' });
    }

    // Move chunk para arquivo com nome previsível
    const chunkPath = path.join(TEMP_DIR, `${uploadId}_chunk_${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);

    const total = parseInt(totalChunks);
    const index = parseInt(chunkIndex);

    // Se não é o último chunk, apenas confirma recebimento
    if (index < total - 1) {
      return res.json({ received: index + 1, total });
    }

    // Último chunk — lock distribuído via Redis para prevenir race condition multi-instância
    const lockKey = `assembly:${uploadId}`;
    const acquired = await acquireLock(lockKey, 10 * 60 * 1000); // TTL 10min (proteção contra crash)
    if (!acquired) {
      return res.status(409).json({ error: 'Arquivo já está sendo montado. Aguarde.' });
    }

    let finalPath;
    try {
      finalPath = path.join(TEMP_DIR, `${uploadId}${ext}`);
      // Remove arquivo final se existir de tentativa anterior
      try { await fs.promises.unlink(finalPath); } catch { /* ignora */ }

      // Usa posição explícita (64-bit) para suportar arquivos > 4GB no Windows
      const fh = await fs.promises.open(finalPath, 'w');
      let position = 0;
      try {
        for (let i = 0; i < total; i++) {
          const p = path.join(TEMP_DIR, `${uploadId}_chunk_${i}`);
          const data = await fs.promises.readFile(p);
          await fh.write(data, 0, data.length, position);
          position += data.length;
          await fs.promises.unlink(p);
        }
      } finally {
        await fh.close();
      }

      const job = await createJobFromFile(finalPath, fileName, content_type, summoner_name, riot_region);
      res.status(201).json({ job });
    } finally {
      await releaseLock(lockKey);
    }
  } catch (err) {
    // Limpa arquivo temporário do multer se não foi movido
    if (multerFilePath && fs.existsSync(multerFilePath)) {
      try { fs.unlinkSync(multerFilePath); } catch { /* ignora erro de cleanup */ }
    }
    next(err);
  }
});

// GET /api/jobs — lista jobs com paginação opcional (?page=1&limit=50)
router.get('/', async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const jobs = await listJobs({ page, limit });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:id — retorna status de um job
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const job = await getJob(id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(job);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:id/transcription — retorna transcrição com timestamps
router.get('/:id/transcription', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    const transcription = await getTranscription(req.params.id);
    if (!transcription) {
      return res.status(404).json({ error: 'Transcrição não disponível ainda', job_status: job.status });
    }

    res.json(transcription);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:id/suggestions — lista sugestões de corte
// Query param opcional: ?category=highlight|educational|funny
const VALID_SUGGESTION_CATEGORIES = ['highlight', 'educational', 'funny'];
router.get('/:id/suggestions', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    const { category } = req.query;
    const safeCategory = VALID_SUGGESTION_CATEGORIES.includes(category) ? category : undefined;

    const suggestions = await getSuggestions(req.params.id, safeCategory);
    res.json({ job_status: job.status, suggestions });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:id/suggestions/bulk-approve — aprova sugestões em lote
// Query opcional: ?category=highlight|educational|funny&type=video|reel
router.post('/:id/suggestions/bulk-approve', async (req, res, next) => {
  try {
    const jobId = parseInt(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ error: 'ID inválido' });

    const job = await getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    const VALID_CATEGORIES = ['highlight', 'educational', 'funny'];
    const VALID_TYPES = ['video', 'reel'];
    const { category, type } = req.query;

    const safeCategory = VALID_CATEGORIES.includes(category) ? category : null;
    const safeType = VALID_TYPES.includes(type) ? type : null;

    const params = [jobId];
    let whereExtra = '';
    if (safeCategory) { params.push(safeCategory); whereExtra += ` AND clip_category=$${params.length}`; }
    if (safeType)     { params.push(safeType);     whereExtra += ` AND type=$${params.length}`; }

    const result = await query(
      `UPDATE clip_suggestions SET status='approved'
       WHERE job_id=$1 AND status='pending'${whereExtra}
       RETURNING id`,
      params
    );

    const approved = result.rows.map(r => r.id);
    approved.forEach(id => {
      enqueueClip(id).catch(err =>
        logger.error({ err, suggestion_id: id }, 'Falha ao enfileirar clip no bulk-approve')
      );
    });

    res.json({ approved: approved.length, suggestion_ids: approved });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:id/reanalyze — re-executa análise GPT (com content_type opcional)
router.post('/:id/reanalyze', async (req, res, next) => {
  try {
    const jobId = parseInt(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ error: 'ID inválido' });

    const job = await getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    const { content_type } = req.body;
    const { VALID_CONTENT_TYPES } = require('../modules/downloader/job.service');

    if (content_type && !VALID_CONTENT_TYPES.includes(content_type)) {
      return res.status(400).json({ error: `content_type inválido. Valores aceitos: ${VALID_CONTENT_TYPES.join(', ')}` });
    }

    // Atualiza content_type se fornecido e reseta status para 'transcribed'
    if (content_type && content_type !== job.content_type) {
      await query('UPDATE jobs SET content_type=$1 WHERE id=$2', [content_type, jobId]);
    }

    await query(
      `UPDATE jobs SET status='transcribed', error_message=NULL, updated_at=NOW() WHERE id=$1`,
      [jobId]
    );

    await enqueueAnalysis(jobId);
    logger.info({ job_id: jobId, content_type: content_type || job.content_type }, 'Re-análise enfileirada');

    res.json({ message: 'Re-análise iniciada', job_id: jobId, content_type: content_type || job.content_type });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
