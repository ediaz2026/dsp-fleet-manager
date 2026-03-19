const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.join(__dirname, 'server');
const logFile = path.join(__dirname, 'update-manager-output.txt');
const lines = [];

const nodeEnv = {
  ...process.env,
  PATH: 'C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd;' + (process.env.PATH || ''),
};

function run(cmd) {
  lines.push(`$ ${cmd}`);
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', env: nodeEnv });
    lines.push(out || '(no output)');
  } catch (e) {
    lines.push('stdout: ' + (e.stdout || '(none)'));
    lines.push('stderr: ' + (e.stderr || '(none)'));
    lines.push('exit: ' + e.status);
  }
  lines.push('');
}

lines.push('=== Update Manager Account — ' + new Date().toISOString() + ' ===\n');
run('node src/db/updateManagerAccount.js');
lines.push('=== DONE ===');

fs.writeFileSync(logFile, lines.join('\n'), 'utf8');
process.stdout.write('Done. Check update-manager-output.txt\n');
