const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.join(__dirname);
const logFile = path.join(__dirname, 'git-push-output.txt');
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

lines.push('=== Node version: ' + process.version + ' ===');
lines.push('');

run('git --version');
run('git log --oneline -3');

// Stage everything (as user requested: git add .)
run('git add .');
run('git status --short');

run('git commit -m "Add Railway deployment config"');
run('git push origin main');
lines.push('=== DONE ===');

fs.writeFileSync(logFile, lines.join('\n'), 'utf8');
process.stdout.write('Done.\n');
