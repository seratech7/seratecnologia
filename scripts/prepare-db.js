const fs = require('fs');
const path = require('path');

const target = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : null;

if (!target) {
  console.log('[prepare-db] DB_PATH nao definido; usando database.sqlite do repo.');
  process.exit(0);
}

try {
  fs.mkdirSync(path.dirname(target), { recursive: true });
} catch (e) {}

if (fs.existsSync(target)) {
  console.log('[prepare-db] Banco ja existe em ' + target + ' (mantido).');
  process.exit(0);
}

const src = path.join(__dirname, '..', 'database.sqlite');
if (fs.existsSync(src)) {
  fs.copyFileSync(src, target);
  console.log('[prepare-db] Copiado database.sqlite -> ' + target);
} else {
  console.log('[prepare-db] Sem database.sqlite no repo para copiar.');
}
