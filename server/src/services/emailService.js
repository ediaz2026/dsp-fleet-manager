/**
 * emailService.js
 * Sends transactional emails via SMTP (nodemailer).
 *
 * Required env vars (configure in .env):
 *   SMTP_HOST   — e.g. smtp.gmail.com  or smtp.sendgrid.net
 *   SMTP_PORT   — e.g. 587
 *   SMTP_USER   — SMTP username / API key
 *   SMTP_PASS   — SMTP password / API secret
 *   SMTP_FROM   — "From" address, e.g. "Last Mile DSP <noreply@lastmiledsp.com>"
 *   APP_URL     — base URL shown in email links, e.g. https://yourdomain.com
 *
 * If SMTP_HOST is not set the service logs a warning and skips sending.
 * This keeps the server working even before email is configured.
 */

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  console.warn('[email] nodemailer not installed — email features disabled');
}

// Log SMTP config status at startup (after a short delay so env vars are loaded)
setTimeout(() => {
  const vars = { SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS ? '***set***' : undefined, SMTP_FROM: process.env.SMTP_FROM, APP_URL: process.env.APP_URL };
  const missing = Object.entries(vars).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === 0) {
    console.log('[email] ✅ SMTP configured:', { host: vars.SMTP_HOST, port: vars.SMTP_PORT, user: vars.SMTP_USER, from: vars.SMTP_FROM, app_url: vars.APP_URL });
  } else {
    console.warn('[email] ⚠️  SMTP not fully configured. Missing vars:', missing.join(', '));
    console.warn('[email]    Email sending will be skipped until all SMTP vars are set.');
  }
}, 100);

function getTransporter() {
  if (!nodemailer) {
    console.error('[email] nodemailer package not installed');
    return null;
  }
  if (!process.env.SMTP_HOST) {
    console.warn('[email] Email sending skipped - SMTP not configured (SMTP_HOST missing)');
    return null;
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[email] Email sending skipped - SMTP not configured (SMTP_USER or SMTP_PASS missing)');
    return null;
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Read dynamically per-call so Railway env vars are always current
function getFrom()   { return process.env.SMTP_FROM || 'Last Mile DSP <noreply@lastmiledsp.com>'; }
function getAppUrl() { return process.env.APP_URL   || 'http://localhost:5173'; }

/**
 * Format a shift_date value (Date object or ISO string) to "Mon, Jan 5"
 */
function fmtDate(raw) {
  try {
    const d = raw instanceof Date ? raw : new Date(String(raw).slice(0, 10) + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return String(raw).slice(0, 10); }
}

/**
 * Format a TIME string "HH:MM:SS" to "9:00 AM"
 */
function fmtTime(raw) {
  if (!raw) return '';
  try {
    const [h, m] = (String(raw)).split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  } catch { return String(raw).slice(0, 5); }
}

/**
 * Build an HTML email body for a schedule notification.
 *
 * @param {string} firstName
 * @param {string} weekLabel  e.g. "Mar 23 – Mar 29"
 * @param {Array}  shifts     array of { shift_date, shift_type, start_time, end_time }
 * @returns {string} HTML string
 */
function buildScheduleHtml(firstName, weekLabel, shifts) {
  const rows = shifts
    .sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
    .map(s => {
      const time = s.start_time && s.end_time
        ? `${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}`
        : '';
      return `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1e293b;white-space:nowrap;">
            ${fmtDate(s.shift_date)}
          </td>
          <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#2563eb;font-weight:600;">
            ${s.shift_type || 'Shift'}
          </td>
          <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap;">
            ${time}
          </td>
        </tr>`;
    }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:#1E3A5F;padding:24px 32px;">
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">Last Mile DSP</p>
      <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;letter-spacing:0.05em;">SCHEDULE UPDATE</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi <strong>${firstName}</strong>,</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
        Your schedule has been updated for the week of <strong>${weekLabel}</strong>.
      </p>

      <p style="margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Your Shifts</p>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;border-bottom:1px solid #e2e8f0;">Date</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;border-bottom:1px solid #e2e8f0;">Shift</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;border-bottom:1px solid #e2e8f0;">Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <!-- CTA Button -->
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${getAppUrl()}/my-schedule"
           style="display:inline-block;background:#16a34a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">
          View My Schedule
        </a>
      </div>

      <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;text-align:center;">
        Questions? Contact your dispatcher.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">Last Mile DSP Team · This is an automated message</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send a schedule-published notification email to one driver.
 *
 * @param {object} driver   { first_name, last_name, email }
 * @param {string} weekLabel  e.g. "Mar 23 – Mar 29"
 * @param {Array}  shifts   array of shift objects for this driver
 * @returns {Promise<boolean>}  true = sent, false = skipped/failed
 */
async function sendScheduleNotification(driver, weekLabel, shifts) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[email] SMTP not configured — skipping email to ${driver.email}`);
    return false;
  }

  try {
    const html = buildScheduleHtml(driver.first_name, weekLabel, shifts);
    await transporter.sendMail({
      from: getFrom(),
      to: driver.email,
      subject: `Your Schedule Has Been Updated - Last Mile DSP`,
      html,
    });
    console.log(`[email] ✅ Sent schedule notification to ${driver.email}`);
    return true;
  } catch (err) {
    console.error(`[email] ❌ Failed to send to ${driver.email}:`, err.message);
    return false;
  }
}

/**
 * Send a password reset email.
 * @param {object} staff  { first_name, email }
 * @param {string} token  the reset token
 */
async function sendPasswordResetEmail(staff, token) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[email] SMTP not configured — skipping password reset email to ${staff.email}`);
    return false;
  }

  const resetUrl = `${getAppUrl()}/reset-password/${token}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
  <div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1E3A5F;padding:24px 32px;">
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">DSP Fleet Manager</p>
      <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;letter-spacing:0.05em;">PASSWORD RESET</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi <strong>${staff.first_name}</strong>,</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
        We received a request to reset your password. Click the button below to choose a new password.
        This link expires in <strong>24 hours</strong>.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}"
           style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">
          Reset My Password
        </a>
      </div>
      <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;text-align:center;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">DSP Fleet Manager · This is an automated message</p>
    </div>
  </div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: getFrom(),
      to: staff.email,
      subject: 'Password Reset - DSP Fleet Manager',
      html,
    });
    console.log(`[email] ✅ Sent password reset to ${staff.email}`);
    return true;
  } catch (err) {
    console.error(`[email] ❌ Failed to send password reset to ${staff.email}:`, err.message);
    return false;
  }
}

/**
 * Send a welcome / account invitation email to a new driver.
 * @param {object} staff  { first_name, last_name, email, invitation_token }
 */
async function sendInvitationEmail(staff) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[email] SMTP not configured — skipping invitation email to ${staff.email}`);
    return false;
  }

  const inviteUrl = `${getAppUrl()}/accept-invitation/${staff.invitation_token}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
  <div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1E3A5F;padding:24px 32px;">
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">DSP Fleet Manager</p>
      <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;letter-spacing:0.05em;">WELCOME — SET UP YOUR ACCOUNT</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi <strong>${staff.first_name}</strong>,</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
        You've been added to the DSP Fleet Manager. Click the button below to set up your password and access your schedule.
        This link expires in <strong>7 days</strong>.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${inviteUrl}"
           style="display:inline-block;background:#16a34a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">
          Set Up My Account
        </a>
      </div>
      <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;text-align:center;">
        Questions? Contact your dispatcher.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">DSP Fleet Manager · This is an automated message</p>
    </div>
  </div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: getFrom(),
      to: staff.email,
      subject: 'Welcome to DSP Fleet Manager - Set Up Your Account',
      html,
    });
    console.log(`[email] ✅ Sent invitation to ${staff.email}`);
    return true;
  } catch (err) {
    console.error(`[email] ❌ Failed to send invitation to ${staff.email}:`, err.message);
    return false;
  }
}

/**
 * Send a plain test email to verify SMTP config.
 * @param {string} toEmail
 * @returns {Promise<{ok: boolean, message: string, config: object}>}
 */
async function sendTestEmail(toEmail) {
  const config = {
    SMTP_HOST:  process.env.SMTP_HOST  || '(not set)',
    SMTP_PORT:  process.env.SMTP_PORT  || '(not set)',
    SMTP_USER:  process.env.SMTP_USER  || '(not set)',
    SMTP_PASS:  process.env.SMTP_PASS  ? '***set***' : '(not set)',
    SMTP_FROM:  process.env.SMTP_FROM  || '(not set)',
    APP_URL:    process.env.APP_URL    || '(not set)',
    nodemailer: nodemailer ? 'installed' : 'NOT INSTALLED',
  };

  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, message: 'SMTP not configured — check missing vars above', config };
  }

  try {
    const info = await transporter.sendMail({
      from: getFrom(),
      to: toEmail,
      subject: 'DSP Fleet Manager — Email Test',
      html: `<p>This is a test email from DSP Fleet Manager.</p><p>If you received this, SMTP is working correctly.</p><p>Sent: ${new Date().toISOString()}</p>`,
    });
    console.log(`[email] ✅ Test email sent to ${toEmail}`, info.messageId);
    return { ok: true, message: `Email sent successfully (messageId: ${info.messageId})`, config };
  } catch (err) {
    console.error(`[email] ❌ Test email failed:`, err);
    return { ok: false, message: err.message, code: err.code, config };
  }
}

module.exports = { sendScheduleNotification, sendPasswordResetEmail, sendInvitationEmail, sendTestEmail };
