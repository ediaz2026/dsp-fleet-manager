const router = require('express').Router();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

// ─── In-memory sync session store (ephemeral — no DB needed) ─────────────────
const sessions = new Map();
let counter = 0;

const STEP_LABELS = [
  'Connecting to Cortex...',
  'Downloading Routes File...',
  'Downloading Week Schedule...',
  'Processing data...',
  'Populating Ops Planner...',
  'Cross-referencing with Schedule...',
  'Complete!',
];

function makeSession() {
  const id = String(++counter);
  const session = {
    id,
    status: 'pending',   // pending | running | complete | error | cancelled
    currentStep: 0,
    steps: STEP_LABELS.map(label => ({ label, status: 'pending' })),
    summary: null,
    error: null,
    clients: [],         // SSE response objects
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  // Auto-expire after 30 minutes
  setTimeout(() => sessions.delete(id), 30 * 60 * 1000);
  return session;
}

function pushToClients(session, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  session.clients = session.clients.filter(c => {
    try { c.write(msg); return true; } catch { return false; }
  });
}

function sessionPublic(s) {
  const { clients, ...safe } = s;
  return safe;
}

// ─── POST /api/cortex-sync/start ─────────────────────────────────────────────
// Creates a new sync session (cancels any existing pending/running one)
router.post('/start', authMiddleware, (req, res) => {
  for (const [id, s] of sessions) {
    if (s.status === 'pending' || s.status === 'running') {
      s.status = 'cancelled';
      pushToClients(s, 'cancelled', {});
      sessions.delete(id);
    }
  }
  const session = makeSession();
  res.json({ id: session.id, steps: session.steps });
});

// ─── GET /api/cortex-sync/active ─────────────────────────────────────────────
// Returns the current active session, or null
router.get('/active', authMiddleware, (req, res) => {
  for (const s of sessions.values()) {
    if (s.status === 'pending' || s.status === 'running') {
      return res.json(sessionPublic(s));
    }
  }
  res.json(null);
});

// ─── GET /api/cortex-sync/:id/events  (Server-Sent Events) ───────────────────
// EventSource doesn't support custom headers, so token comes as query param
router.get('/:id/events', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if applicable
  res.flushHeaders();

  // Send current state immediately
  res.write(`event: state\ndata: ${JSON.stringify(sessionPublic(session))}\n\n`);

  // Keep-alive ping every 20s
  const pingInterval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(pingInterval); }
  }, 20000);

  session.clients.push(res);
  req.on('close', () => {
    clearInterval(pingInterval);
    session.clients = session.clients.filter(c => c !== res);
  });
});

// ─── POST /api/cortex-sync/:id/update ────────────────────────────────────────
// Called by the Claude in Chrome automation to advance steps.
// No user auth required — session ID acts as the shared secret.
router.post('/:id/update', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { step, status = 'complete', error, summary } = req.body;

  if (step !== undefined && step >= 0 && step < session.steps.length) {
    session.steps[step].status = status;

    if (status === 'error') {
      session.status = 'error';
      session.error = error || 'An error occurred';
      session.currentStep = step;
    } else if (status === 'running') {
      session.status = 'running';
      session.currentStep = step;
    } else if (status === 'complete') {
      session.currentStep = step + 1;
      session.status = (step === session.steps.length - 1) ? 'complete' : 'running';
    }
  }

  if (summary) session.summary = summary;

  pushToClients(session, 'update', sessionPublic(session));
  res.json({ ok: true, currentStep: session.currentStep, status: session.status });
});

// ─── GET /api/cortex-sync/local-files?pattern= ───────────────────────────────
// Lists .xlsx files in the user's Downloads folder matching an optional pattern
router.get('/local-files', authMiddleware, (req, res) => {
  const { pattern = '' } = req.query;
  const downloadsPath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Downloads'
  );
  try {
    const files = fs.readdirSync(downloadsPath)
      .filter(f => f.toLowerCase().includes(pattern.toLowerCase()) && f.endsWith('.xlsx'))
      .sort()
      .reverse()
      .slice(0, 20);
    res.json({ files, downloadsPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/cortex-sync/local-file?filename= ───────────────────────────────
// Streams a single .xlsx file from the user's Downloads folder to the browser
router.get('/local-file', authMiddleware, (req, res) => {
  const { filename } = req.query;
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  if (!filename.endsWith('.xlsx')) {
    return res.status(400).json({ error: 'Only .xlsx files are allowed' });
  }
  const downloadsPath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Downloads',
    filename
  );
  if (!fs.existsSync(downloadsPath)) {
    return res.status(404).json({ error: `File not found: ${filename}` });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.sendFile(downloadsPath);
});

// ─── DELETE /api/cortex-sync/:id ─────────────────────────────────────────────
// Cancel and remove a session
router.delete('/:id', authMiddleware, (req, res) => {
  const session = sessions.get(req.params.id);
  if (session) {
    session.status = 'cancelled';
    pushToClients(session, 'cancelled', {});
    sessions.delete(req.params.id);
  }
  res.json({ ok: true });
});

module.exports = router;
