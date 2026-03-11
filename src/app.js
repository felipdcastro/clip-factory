const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const path = require('path');

const healthRouter = require('./routes/health');
const jobsRouter = require('./routes/jobs');
const clipsRouter = require('./routes/clips');
const suggestionsRouter = require('./routes/suggestions');
const authRouter = require('./routes/auth');
const uploadsRouter = require('./routes/uploads');

const app = express();

// Security & parsing middlewares
app.use(helmet({ contentSecurityPolicy: false })); // CSP desabilitado para assets inline no MVP
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session (24h)
app.use(cookieSession({
  name: 'cf_session',
  secret: process.env.SESSION_SECRET || 'clip-factory-secret-change-me',
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
}));

// Auth middleware — protege tudo exceto /health, /auth e /login.html
function requireAuth(req, res, next) {
  const publicPaths = ['/health', '/auth/login', '/auth/logout', '/login.html', '/style.css'];
  if (publicPaths.some(p => req.path.startsWith(p))) return next();
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado' });
  res.redirect('/login.html');
}

app.use(requireAuth);

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes (público)
app.use('/auth', authRouter);

// API routes (protegidas)
app.use('/health', healthRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/clips', clipsRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/uploads', uploadsRouter);

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

module.exports = app;
