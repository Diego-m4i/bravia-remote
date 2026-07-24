// Copia i file condivisi con il progetto principale (server, agent, pagina
// web) dentro desktop-app/build, cosi' electron-builder puo' impacchettarli
// senza dover uscire dalla cartella del progetto Electron.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEST = path.join(__dirname, '..', 'build');

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(DEST, 'server.js'));
fs.copyFileSync(path.join(ROOT, 'desktop-agent.js'), path.join(DEST, 'desktop-agent.js'));
fs.cpSync(path.join(ROOT, 'public'), path.join(DEST, 'public'), { recursive: true });

console.log('File condivisi copiati in', DEST);
