const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 3000;
process.env.PORT = String(PORT);
process.env.RELAY_URL = `ws://localhost:${PORT}`;
// tv-config.json non puo' vivere dentro l'app impacchettata (sola lettura):
// lo salviamo nella cartella dati dell'utente, persistente tra un avvio e l'altro.
process.env.TV_CONFIG_DIR = app.getPath('userData');

const CONFIG_PATH = path.join(app.getPath('userData'), 'tv-config.json');

// Interroga il relay finche' non compare un codice di pairing (l'agent lo
// crea appena si connette), cosi' possiamo aprire il telecomando gia'
// collegato invece di far digitare il codice a mano.
function waitForPairingCode(timeoutMs = 30000, intervalMs = 300) {
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

// Aspetta che l'utente inserisca l'IP della TV nella pagina di setup (nessun
// timeout stretto: dipende da quanto ci mette la persona a leggere e scrivere).
function waitForConfigFile(intervalMs = 500) {
  return new Promise((resolve) => {
    function check() {
      if (fs.existsSync(CONFIG_PATH)) { resolve(); return; }
      setTimeout(check, intervalMs);
    }
    check();
  });
}

async function createWindow() {
  require('./build/server.js');

  const win = new BrowserWindow({
    width: 460,
    height: 840,
    minWidth: 380,
    minHeight: 600,
    title: 'PairBeam',
    autoHideMenuBar: true,
    backgroundColor: '#0f0f11',
    icon: path.join(__dirname, 'assets/icon.png'),
  });

  // Da' un'icona vera alla finestra del popup (Tasto "Popup" nel telecomando),
  // che altrimenti erediterebbe l'icona generica di Electron.
  win.webContents.setWindowOpenHandler((details) => {
    if (details.frameName === 'PairBeamPopup') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          icon: path.join(__dirname, 'assets/icon.png'),
          backgroundColor: '#0f0f11',
          autoHideMenuBar: true,
        },
      };
    }
    return { action: 'allow' };
  });

  if (!fs.existsSync(CONFIG_PATH)) {
    // Primo avvio: niente scansione automatica della rete (dipende troppo
    // da quale rete e' attiva sul PC in quel momento). Chiediamo l'IP
    // direttamente all'utente, una volta sola.
    win.loadURL(`http://localhost:${PORT}/setup.html`);
    await waitForConfigFile();
  }

  require('./build/desktop-agent.js');

  const code = await waitForPairingCode();
  const url = code
    ? `http://localhost:${PORT}/mobile.html?code=${code}`
    : `http://localhost:${PORT}/mobile.html`;
  win.loadURL(url);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
