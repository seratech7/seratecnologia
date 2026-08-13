const { execSync } = require('child_process');
const path = require('path');
const { backupDatabase } = require('./backup-db');

const repoDir = __dirname;
// NEVER embed the token in the git remote URL — it would be persisted in .git/config.
// Push relies on the local credential helper (Windows Credential Manager) or GITHUB_TOKEN set as an env var
// consumed by git itself. If neither is available, the push simply fails (safe).

function run(cmd, env) {
  try {
    return execSync(cmd, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe', env: env || process.env, timeout: 60000 }).trim();
  } catch (e) {
    return null;
  }
}

function autoSave() {
  backupDatabase();

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

  run(`git commit -m "${msg}"`);

  const push = run('git push origin master');
  if (push) {
    console.log(`[autosave] ok: ${msg}`);
  } else {
    console.log('[autosave] push falhou (sem credencial disponível ou erro)');
  }
}

module.exports = { autoSave };