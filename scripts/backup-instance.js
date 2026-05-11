const fs = require('fs');
const path = require('path');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

const backupRoot = path.join(process.cwd(), 'backups', timestamp());
fs.mkdirSync(backupRoot, { recursive: true });

copyIfExists(path.join(process.cwd(), 'db', 'db.db'), path.join(backupRoot, 'db', 'db.db'));
copyIfExists(path.join(process.cwd(), 'db', 'db.db-shm'), path.join(backupRoot, 'db', 'db.db-shm'));
copyIfExists(path.join(process.cwd(), 'db', 'db.db-wal'), path.join(backupRoot, 'db', 'db.db-wal'));
copyIfExists(path.join(process.cwd(), 'public', 'media'), path.join(backupRoot, 'public', 'media'));
copyIfExists(path.join(process.cwd(), '.env'), path.join(backupRoot, '.env'));

console.log(`backup complete: ${backupRoot}`);
