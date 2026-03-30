/**
 * emailService.js
 * Sends transactional emails via Resend.
 *
 * Required env vars:
 *   RESEND_API_KEY    — Resend API key
 *   RESEND_FROM_EMAIL — "From" address, e.g. "Last Mile DSP <noreply@lsmddsp.com>"
 *   APP_URL           — base URL shown in email links
 *
 * If RESEND_API_KEY is not set the service logs a warning and skips sending.
 */

let Resend;
try {
  Resend = require('resend').Resend;
} catch {
  console.warn('[email] resend package not installed — email features disabled');
}

function getResendClient() {
  if (!Resend) return null;
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] Email sending skipped — RESEND_API_KEY not set');
    return null;
  }
  return new Resend(process.env.RESEND_API_KEY);
}

function getFrom()   { return process.env.RESEND_FROM_EMAIL || 'DSP Fleet Manager <onboarding@resend.dev>'; }
function getAppUrl() { return process.env.APP_URL || 'http://localhost:5173'; }

// Log config status at startup
setTimeout(() => {
  const hasKey = !!process.env.RESEND_API_KEY;
  const from = getFrom();
  if (hasKey) {
    console.log('[email] ✅ Resend configured:', { from, app_url: process.env.APP_URL });
  } else {
    console.warn('[email] ⚠️  RESEND_API_KEY not set. Email sending will be skipped.');
  }
}, 100);

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
 */
async function sendScheduleNotification(driver, weekLabel, shifts) {
  const resend = getResendClient();
  if (!resend) {
    console.warn(`[email] Resend not configured — skipping email to ${driver.email}`);
    return false;
  }

  try {
    const html = buildScheduleHtml(driver.first_name, weekLabel, shifts);
    const { error } = await resend.emails.send({
      from: getFrom(),
      to: driver.email,
      subject: `Your Schedule Has Been Updated - Last Mile DSP`,
      html,
    });
    if (error) throw new Error(error.message);
    console.log(`[email] ✅ Sent schedule notification to ${driver.email}`);
    return true;
  } catch (err) {
    console.error(`[email] ❌ Failed to send to ${driver.email}:`, err.message);
    return false;
  }
}

/**
 * Send a password reset email.
 */
async function sendPasswordResetEmail(staff, token) {
  const resend = getResendClient();
  if (!resend) {
    console.warn(`[email] Resend not configured — skipping password reset email to ${staff.email}`);
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
    const { error } = await resend.emails.send({
      from: getFrom(),
      to: staff.email,
      subject: 'Password Reset - DSP Fleet Manager',
      html,
    });
    if (error) throw new Error(error.message);
    console.log(`[email] ✅ Sent password reset to ${staff.email}`);
    return true;
  } catch (err) {
    console.error(`[email] ❌ Failed to send password reset to ${staff.email}:`, err.message);
    return false;
  }
}

/**
 * Send a welcome / account invitation email to a new driver.
 */
async function sendInvitationEmail(staff) {
  const resend = getResendClient();
  if (!resend) {
    console.warn(`[email] Resend not configured — skipping invitation email to ${staff.email}`);
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
    const { error } = await resend.emails.send({
      from: getFrom(),
      to: staff.email,
      subject: 'Welcome to DSP Fleet Manager - Set Up Your Account',
      html,
    });
    if (error) throw new Error(error.message);
    console.log(`[email] ✅ Sent invitation to ${staff.email}`);
    return true;
  } catch (err) {
    console.error(`[email] ❌ Failed to send invitation to ${staff.email}:`, err.message);
    return false;
  }
}

/**
 * Send a plain test email to verify Resend config.
 */
async function sendTestEmail(toEmail) {
  const config = {
    RESEND_API_KEY:    process.env.RESEND_API_KEY ? '***set***' : '(not set)',
    RESEND_FROM_EMAIL: getFrom(),
    APP_URL:           process.env.APP_URL || '(not set)',
    resend:            Resend ? 'installed' : 'NOT INSTALLED',
  };

  const resend = getResendClient();
  if (!resend) {
    return { ok: false, message: 'Resend not configured — check RESEND_API_KEY', config };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: toEmail,
      subject: 'DSP Fleet Manager — Email Test',
      html: `<p>This is a test email from DSP Fleet Manager.</p><p>If you received this, Resend is working correctly.</p><p>Sent: ${new Date().toISOString()}</p>`,
    });
    if (error) throw new Error(error.message);
    console.log(`[email] ✅ Test email sent to ${toEmail}`, data?.id);
    return { ok: true, message: `Email sent successfully (id: ${data?.id})`, config };
  } catch (err) {
    console.error(`[email] ❌ Test email failed:`, err.message);
    return { ok: false, message: err.message, config };
  }
}

module.exports = { sendScheduleNotification, sendPasswordResetEmail, sendInvitationEmail, sendTestEmail };
