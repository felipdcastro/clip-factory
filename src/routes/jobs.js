const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { createJob, createJobFromFile, getJob, listJobs } = require('../modules/downloader/job.service');
const { getTranscription } = require('../modules/transcriber/transcription.service');
const { getSuggestions } = require('../modules/analyzer/analyzer.service');

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

// Trava em memória para prevenir race condition na montagem do arquivo final
const assemblingUploads = new Set();

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
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Campo "url" é obrigatório' });
    }

    const job = await createJob(url.trim());
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
    const job = await createJobFromFile(req.file.path, req.file.originalname);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/upload-chunk — recebe chunks e monta arquivo final
router.post('/upload-chunk', chunkUpload.single('chunk'), async (req, res, next) => {
  const multerFilePath = req.file?.path;
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
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

    // Último chunk — verifica se já está sendo montado (race condition)
    if (assemblingUploads.has(uploadId)) {
      return res.status(409).json({ error: 'Arquivo já está sendo montado. Aguarde.' });
    }
    assemblingUploads.add(uploadId);

    let finalPath;
    try {
      finalPath = path.join(TEMP_DIR, `${uploadId}${ext}`);
      const writeStream = fs.createWriteStream(finalPath);

      for (let i = 0; i < total; i++) {
        const p = path.join(TEMP_DIR, `${uploadId}_chunk_${i}`);
        const data = fs.readFileSync(p);
        writeStream.write(data);
        fs.unlinkSync(p);
      }

      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      const job = await createJobFromFile(finalPath, fileName);
      res.status(201).json({ job });
    } finally {
      assemblingUploads.delete(uploadId);
    }
  } catch (err) {
    // Limpa arquivo temporário do multer se não foi movido
    if (multerFilePath && fs.existsSync(multerFilePath)) {
      try { fs.unlinkSync(multerFilePath); } catch { /* ignora erro de cleanup */ }
    }
    next(err);
  }
});

// GET /api/jobs — lista todos os jobs
router.get('/', async (req, res, next) => {
  try {
    const jobs = await listJobs();
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
router.get('/:id/suggestions', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    const suggestions = await getSuggestions(req.params.id);
    res.json({ job_status: job.status, suggestions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
