const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'database.sqlite');
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(__dirname, 'database', 'backups');
const MAX_KEPT = 30;

function ensureDir() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function rotateBackups(maxKept = MAX_KEPT) {
  if (!fs.existsSync(backupDir)) return;
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.sqlite'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length > maxKept) {
    files.slice(maxKept).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f.name)); } catch(e) {}
    });
  }
}

function backupDatabase() {
  if (!fs.existsSync(dbPath)) {
    console.log('[backup] database.sqlite não encontrado');
    return null;
  }

  ensureDir();

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const filename = `backup-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.sqlite`;
  const dest = path.join(backupDir, filename);

  fs.copyFileSync(dbPath, dest);
  rotateBackups(MAX_KEPT);
  console.log(`[backup] ${filename} (mantidos últimos ${MAX_KEPT})`);
  return filename;
}

function getBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.sqlite'))
    .map(f => {
      const st = fs.statSync(path.join(backupDir, f));
      return { name: f, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function restoreBackup(filename) {
  if (!filename) return { ok: false, error: 'Nome de arquivo inválido' };
  const safe = path.basename(filename);
  if (!safe.endsWith('.sqlite')) return { ok: false, error: 'Extensão inválida' };
  const src = path.join(backupDir, safe);
  if (!fs.existsSync(src)) return { ok: false, error: 'Backup não encontrado' };
  backupDatabase();
  fs.copyFileSync(src, dbPath);
  return { ok: true, name: safe };
}

function restoreFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Arquivo não encontrado' };
  backupDatabase();
  fs.copyFileSync(filePath, dbPath);
  return { ok: true };
}

module.exports = { backupDatabase, getBackups, restoreBackup, restoreFromFile };
