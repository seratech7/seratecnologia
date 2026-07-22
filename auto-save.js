const { execSync } = require('child_process');
const path = require('path');

const repoDir = __dirname;
const token = process.env.GITHUB_TOKEN;
const remoteUrl = `https://seratech7:${token}@github.com/seratech7/seratecnologia.git`;

function run(cmd) {
  try {
    return execSync(cmd, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (e) {
    return null;
  }
}

function autoSave() {
  if (token) {
    run(`git remote set-url origin "${remoteUrl}"`);
  }

  const hasChanges = run('git status --porcelain');
  if (!hasChanges) {
    console.log('[autosave] nada para commitar');
    return;
  }

  run('git add -A');
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const msg = `auto: ${timestamp}`;

  const commit = run(`git commit -m "${msg}"`);
  const push = run('git push origin master');

  if (push) {
    console.log(`[autosave] ok: ${msg}`);
  } else {
    console.log('[autosave] push falhou');
  }
}

module.exports = { autoSave };
