const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.join(__dirname);
const logFile = path.join(__dirname, 'git-production-output.txt');
const lines = [];
const gitEnv = {
  ...process.env,
  PATH: 'C:\\Program Files\\Git\\cmd;C:\\Program Files\\Git\\bin;' + (process.env.PATH || ''),
  GIT_AUTHOR_NAME: 'ediaz2026',
  GIT_AUTHOR_EMAIL: 'ediaz2026@github.local',
  GIT_COMMITTER_NAME: 'ediaz2026',
  GIT_COMMITTER_EMAIL: 'ediaz2026@github.local',
};

function run(cmd) {
  lines.push(`$ ${cmd}`);
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', env: gitEnv });
    lines.push(out || '(no output)');
  } catch (e) {
    lines.push('stdout: ' + (e.stdout || '(none)'));
    lines.push('stderr: ' + (e.stderr || '(none)'));
    lines.push('exit code: ' + e.status);
  }
  lines.push('');
}

lines.push('=== Fix SSL in resetAdmin — ' + new Date().toISOString() + ' ===');
lines.push('');

// Show what resetAdmin.js looks like right now
run('git diff HEAD server/src/db/resetAdmin.js');

// Stage everything
run('git add .');

// Show staged diff for resetAdmin.js to confirm it's there
run('git diff --cached server/src/db/resetAdmin.js');

run('git status');
run('git commit -m "Fix SSL in resetAdmin"');
run('git push origin main');
run('git log --oneline -4');

lines.push('=== DONE ===');
fs.writeFileSync(logFile, lines.join('\n'), 'utf8');
process.stdout.write('Done. Check git-production-output.txt\n');
