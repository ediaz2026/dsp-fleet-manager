const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// Configure web-push lazily — only if VAPID keys are set
let webpush = null;
function getWebPush() {
  if (webpush) return webpush;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return null;
  webpush = require('web-push');
  const email = process.env.VAPID_EMAIL || 'admin@lastmiledsp.com';
  webpush.setVapidDetails(
    email.startsWith('mailto:') ? email : `mailto:${email}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return webpush;
}

// GET /api/push/vapid-public-key — returns public key to frontend
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

// TEMP: fix route + diag — remove after use
router.post('/fix-route-428', async (req, res) => {
  try {
    await pool.query(`UPDATE ops_assignments SET route_code = 'CX184' WHERE plan_date = '2026-04-28' AND staff_id = 396`);
    const { rows } = await pool.query(`SELECT staff_id, route_code FROM ops_assignments WHERE plan_date = '2026-04-28' AND staff_id IN (390, 396)`);
    res.json({ updated: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/push/subscribe — save driver's push subscription
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'endpoint and keys required' });
    }
    await pool.query(`
      INSERT INTO push_subscriptions (staff_id, endpoint, p256dh, auth, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (staff_id, endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = NOW()
    `, [req.user.id, endpoint, keys.p256dh, keys.auth, req.headers['user-agent'] || '']);
    res.json({ success: true });
  } catch (err) {
    console.error('[push/subscribe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/unsubscribe
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await pool.query(
      `DELETE FROM push_subscriptions WHERE staff_id = $1 AND endpoint = $2`,
      [req.user.id, endpoint]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send push to a specific driver — used by other server routes
async function sendPushToDriver(staffId, title, body, data = {}) {
  const wp = getWebPush();
  if (!wp) return; // VAPID not configured — silently skip
  try {
    const { rows } = await pool.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE staff_id = $1`, [staffId]
    );
    if (!rows.length) return;
    const payload = JSON.stringify({ title, body, data });
    for (const sub of rows) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
        }
      }
    }
  } catch (err) {
    console.error(`[push] Failed to send to staff ${staffId}:`, err.message);
  }
}

// Send push to ALL subscribed drivers
async function sendPushToAll(title, body, data = {}) {
  const wp = getWebPush();
  if (!wp) return 0;
  try {
    const { rows } = await pool.query(`SELECT DISTINCT staff_id FROM push_subscriptions`);
    for (const r of rows) await sendPushToDriver(r.staff_id, title, body, data);
    return rows.length;
  } catch (err) {
    console.error('[push/send-all]', err.message);
    return 0;
  }
}

// POST /api/push/send — admin sends a manual notification
router.post('/send', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, body, staffId, data } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    if (staffId) {
      await sendPushToDriver(staffId, title, body, data || {});
      res.json({ sent: 1 });
    } else {
      const count = await sendPushToAll(title, body, data || {});
      res.json({ sent: count });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/test — admin sends test push to themselves
router.post('/test', authMiddleware, async (req, res) => {
  try {
    await sendPushToDriver(req.user.id, '🔔 Test Notification', 'Push notifications are working!', { url: '/' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, sendPushToDriver, sendPushToAll };
