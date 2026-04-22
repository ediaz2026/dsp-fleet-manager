const pool = require('../db/pool');
const { sendPushToDriver } = require('../routes/push');

// Track sent reminders in-memory to avoid duplicates within the same server lifecycle
// Key: "staffId|shiftDate|hoursBefore", cleared daily
const sentReminders = new Set();
const clearSentDaily = () => { sentReminders.clear(); };
setInterval(clearSentDaily, 24 * 60 * 60 * 1000);

async function runShiftReminders() {
  try {
    // Read push notification settings
    const { rows: settingsRows } = await pool.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'notifications_push_%'`
    );
    const s = {};
    for (const r of settingsRows) s[r.setting_key] = r.setting_value;

    if (s.notifications_push_enabled !== 'true') return; // push disabled

    const hoursBefore1 = parseInt(s.notifications_push_hours_before) || 12;
    const hasSecond    = s.notifications_push_second_reminder === 'true';
    const hoursBefore2 = hasSecond ? (parseInt(s.notifications_push_second_hours) || 2) : null;

    // Check both reminder windows
    const windows = [hoursBefore1];
    if (hoursBefore2) windows.push(hoursBefore2);

    for (const hours of windows) {
      // Target time: now + hours hours, in Eastern time
      const { rows: timeRows } = await pool.query(`
        SELECT
          ((NOW() AT TIME ZONE 'America/New_York') + ($1 || ' hours')::interval)::date AS target_date,
          to_char((NOW() AT TIME ZONE 'America/New_York') + ($1 || ' hours')::interval, 'HH24:MI') AS target_time
      `, [hours]);
      const { target_date, target_time } = timeRows[0];
      const targetDateStr = typeof target_date === 'string' ? target_date.slice(0, 10) : target_date.toISOString().slice(0, 10);

      // Find published shifts starting within ±3 minutes of target time
      const { rows: shifts } = await pool.query(`
        SELECT s.id, s.staff_id, s.shift_date, s.start_time, s.shift_type,
               st.first_name, st.last_name
        FROM shifts s
        JOIN staff st ON st.id = s.staff_id
        WHERE s.shift_date = $1
          AND s.start_time BETWEEN ($2::time - INTERVAL '3 minutes') AND ($2::time + INTERVAL '3 minutes')
          AND s.shift_type NOT IN ('PTO', 'UTO', 'SUSPENSION', 'ON CALL')
          AND s.publish_status = 'published'
      `, [targetDateStr, target_time]);

      for (const shift of shifts) {
        const key = `${shift.staff_id}|${targetDateStr}|${hours}`;
        if (sentReminders.has(key)) continue;
        sentReminders.add(key);

        const startTime = (shift.start_time || '').slice(0, 5);
        const h = parseInt(startTime.split(':')[0]) || 0;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h % 12) || 12);
        const friendlyTime = `${h12}:${startTime.split(':')[1] || '00'} ${ampm}`;

        const shiftDateDisplay = new Date(targetDateStr + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long', month: 'short', day: 'numeric',
        });

        const isSecondReminder = hours === hoursBefore2;
        const title = isSecondReminder ? '⏰ Shift Starting Soon' : '📅 Shift Reminder';
        const body = isSecondReminder
          ? `${shift.first_name}, your ${shift.shift_type} shift starts in ${hours} hour${hours !== 1 ? 's' : ''} at ${friendlyTime}!`
          : `Hey ${shift.first_name}! Your ${shift.shift_type} shift is ${shiftDateDisplay} at ${friendlyTime}. See you then!`;

        await sendPushToDriver(shift.staff_id, title, body, { url: '/my-schedule' });
        console.log(`[ShiftReminder] Sent ${hours}h reminder to ${shift.first_name} ${shift.last_name} for ${targetDateStr} ${startTime}`);
      }

      if (shifts.length > 0) {
        console.log(`[ShiftReminder] ${hours}h window: ${shifts.length} shifts at ~${target_time} on ${targetDateStr}`);
      }
    }
  } catch (err) {
    console.error('[ShiftReminder] Error:', err.message);
  }
}

module.exports = { runShiftReminders };
