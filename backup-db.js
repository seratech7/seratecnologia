const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'database.sqlite');
const backupDir = path.join(__dirname, 'database', 'backups');

function rotateBackups(maxKept = 7) {
  if (!fs.existsSync(backupDir)) return;
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.sqlite'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length > maxKept) {
    files.slice(maxKept).forEach(f => {
      fs.unlinkSync(path.join(backupDir, f.name));
    });
  }
}

function backupDatabase() {
  if (!fs.existsSync(dbPath)) {
    console.log('[backup] database.sqlite não encontrado');
    return;
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const filename = `backup-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.sqlite`;
  const dest = path.join(backupDir, filename);

  fs.copyFileSync(dbPath, dest);
  rotateBackups(7);
  console.log(`[backup] ${filename} (mantidos últimos 7)`);
}

module.exports = { backupDatabase };
