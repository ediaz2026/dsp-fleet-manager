/**
 * whatsappService.js
 * Sends WhatsApp messages via Twilio.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID    — Twilio Account SID
 *   TWILIO_AUTH_TOKEN     — Twilio Auth Token
 *   TWILIO_WHATSAPP_FROM  — e.g. "whatsapp:+14155238886"
 */

let twilioClient = null;

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  if (!twilioClient) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

async function sendWhatsApp(toPhone, message) {
  const client = getClient();
  if (!client) throw new Error('Twilio not configured');

  const digits = toPhone.replace(/\D/g, '');
  const formatted = digits.length === 10 ? `+1${digits}` : `+${digits}`;

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
    to: `whatsapp:${formatted}`,
    body: message,
  });
}

module.exports = { sendWhatsApp };
