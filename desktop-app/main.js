const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

const PORT = 3000;
process.env.PORT = String(PORT);
process.env.RELAY_URL = `ws://localhost:${PORT}`;
// tv-config.json non puo' vivere dentro l'app impacchettata (sola lettura):
// lo salviamo nella cartella dati dell'utente, persistente tra un avvio e l'altro.
process.env.TV_CONFIG_DIR = app.getPath('userData');

// Interroga il relay finche' non compare un codice di pairing (l'agent lo
// crea appena si connette), cosi' possiamo aprire il telecomando gia'
// collegato invece di far digitare il codice a mano.
function waitForPairingCode(timeoutMs = 10000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    function attempt() {
      const req = http.get(`http://localhost:${PORT}/pairing-code`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const { code } = JSON.parse(data);
            if (code) { resolve(code); return; }
          } catch {
            // ignorato, riproviamo
          }
          if (Date.now() < deadline) setTimeout(attempt, intervalMs);
          else resolve(null);
        });
      });
      req.on('error', () => {
        if (Date.now() < deadline) setTimeout(attempt, intervalMs);
        else resolve(null);
      });
    }
    attempt();
  });
}

async function createWindow() {
  require('./build/server.js');
  require('./build/desktop-agent.js');

  const code = await waitForPairingCode();
  const url = code
    ? `http://localhost:${PORT}/mobile.html?code=${code}`
    : `http://localhost:${PORT}/mobile.html`;

  const win = new BrowserWindow({
    width: 460,
    height: 840,
    minWidth: 380,
    minHeight: 600,
    title: 'Bravia Remote',
    autoHideMenuBar: true,
    backgroundColor: '#0f0f11',
    icon: path.join(__dirname, 'assets/icon.png'),
  });
  win.loadURL(url);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
