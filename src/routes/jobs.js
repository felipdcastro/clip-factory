const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createJob, createJobFromFile, getJob, listJobs } = require('../modules/downloader/job.service');
const { getTranscription } = require('../modules/transcriber/transcription.service');
const { getSuggestions } = require('../modules/analyzer/analyzer.service');

const TEMP_DIR = process.env.TEMP_DIR || './tmp';
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: TEMP_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `upload_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4GB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo são permitidos (mp4, mkv, avi, mov, webm)'));
    }
  },
});

// POST /api/jobs — cria job e inicia download em background
router.post('/', async (req, res, next) => {
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

// POST /api/jobs/upload — cria job a partir de arquivo de vídeo
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
    const job = await getJob(req.params.id);
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
