const os = require('os');
const { Server } = require('node-ssdp');
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}
const ssdpServer = new Server({
location: 'http://' + getLocalIP() + ':8080/description.xml'});
ssdpServer.addUSN('urn:schemas-upnp-org:device:MediaServer:1');
ssdpServer.start();

const WebSocket = require('ws');
const { exec, spawn } = require('child_process');
const dgram = require('dgram');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:3000';
// Quando l'agent gira come eseguibile pacchettizzato (pkg), __dirname punta a un
// filesystem virtuale in sola lettura: il config va salvato accanto al vero .exe.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'tv-config.json');

// Codici IRCC standard Sony Bravia di fallback
const IRCC = {
  power_off: 'AAAAAQAAAAEAAAAvAw==',
  input: 'AAAAAQAAAAEAAAAlAw==',
  sync_menu: 'AAAAAgAAABoAAABYAw==',
  display: 'AAAAAQAAAAEAAAA6Aw==',
  home: 'AAAAAQAAAAEAAABgAw==',
  options: 'AAAAAgAAAJcAAAA2Aw==',
  return: 'AAAAAgAAAJcAAAAjAw==',
  exit: 'AAAAAQAAAAEAAABjAw==',
  
  // Direzionali
  up: 'AAAAAQAAAAEAAAB0Aw==',
  down: 'AAAAAQAAAAEAAAB1Aw==',
  left: 'AAAAAQAAAAEAAAA0Aw==',
  right: 'AAAAAQAAAAEAAAAzAw==',
  confirm: 'AAAAAQAAAAEAAABlAw==',

  // Tastierino Numerico
  num1: 'AAAAAQAAAAEAAAAAAw==',
  num2: 'AAAAAQAAAAEAAAABAw==',
  num3: 'AAAAAQAAAAEAAAACAw==',
  num4: 'AAAAAQAAAAEAAAADAw==',
  num5: 'AAAAAQAAAAEAAAAEAw==',
  num6: 'AAAAAQAAAAEAAAAFAw==',
  num7: 'AAAAAQAAAAEAAAAGAw==',
  num8: 'AAAAAQAAAAEAAAAHAw==',
  num9: 'AAAAAQAAAAEAAAAIAw==',
  num0: 'AAAAAQAAAAEAAAAJAw==',
  dot: 'AAAAAgAAAJcAAAAdAw==',
  enter: 'AAAAAQAAAAEAAAALAw==',

  // Volume, Canali e Mute
  volume_up: 'AAAAAQAAAAEAAAASAw==',
  volume_down: 'AAAAAQAAAAEAAAATAw==',
  mute: 'AAAAAQAAAAEAAAAUAw==',
  channel_up: 'AAAAAQAAAAEAAAAQAw==',
  channel_down: 'AAAAAQAAAAEAAAARAw==',

  // Colore
  red: 'AAAAAgAAAJcAAAAlAw==',
  green: 'AAAAAgAAAJcAAAAmAw==',
  yellow: 'AAAAAgAAAJcAAAAnAw==',
  blue: 'AAAAAgAAAJcAAAAkAw==',

  // Player
  play: 'AAAAAgAAAJcAAAAaAw==',
  pause: 'AAAAAgAAAJcAAAAZAw==',
  stop: 'AAAAAgAAAJcAAAAYAw==',
  rewind: 'AAAAAgAAAJcAAAAbAw==',
  forward: 'AAAAAgAAAJcAAAAcAw==',
  prev: 'AAAAAgAAAJcAAAA8Aw==',
  next: 'AAAAAgAAAJcAAAA9Aw==',

  // Smart App
  netflix: 'AAAAAgAAABoAAAB8Aw==',
  sen: 'AAAAAgAAABoAAAB9Aw=='
};

let tv = null; 

// Esegue i comandi sul terminale del PC
function run(command) {
  exec(command, (err) => {
    if (err) console.error(`Errore eseguendo "${command}": ${err.message}`);
  });
}

// Funzione di risveglio hardware tramite pacchetto UDP (Wake-on-LAN)
function sendBraviaWoL(macAddress) {
    if (!macAddress) {
        console.error("[WoL] Errore: MAC Address non configurato in tv-config.json");
        return;
    }

    const cleanedMac = macAddress.replace(/[: -]/g, '');
    const buf = Buffer.alloc(102);
    
    // Scrive i primi 6 byte con valore 0xFF
    buf.write('FFFFFFFFFFFF', 'hex');
    // Ripete il MAC address per 16 volte consecutivamente nel buffer
    for (let i = 1; i <= 16; i++) {
        buf.write(cleanedMac, i * 6, 'hex');
    }

    const client = dgram.createSocket('udp4');
    client.bind(() => {
        client.setBroadcast(true);
        client.send(buf, 0, buf.length, 9, '255.255.255.255', (err) => {
            if (err) {
                console.error("[WoL] Errore durante l'invio del pacchetto:", err);
            } else {
                console.log(`[WoL] Magic Packet inviato con successo a ${macAddress}`);
            }
            client.close();
        });
    });
}

// Ricava il MAC address di un IP dalla tabella ARP del sistema operativo.
// Funziona su Windows, Linux e macOS; richiede che l'host abbia gia'
// scambiato almeno un pacchetto con quell'IP (una chiamata fetch basta).
function getMacFromArp(ip) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? `arp -a ${ip}` : `arp -n ${ip}`;
    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const match = stdout.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
      resolve(match ? match[0] : null);
    });
  });
}

/* --- Scansione dispositivi in rete (SSDP/UPnP) --- */
function ssdpDiscover(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const locations = new Set();

    const query = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: upnp:rootdevice\r\n\r\n'
    );

    socket.on('message', (msg) => {
      const text = msg.toString();
      const match = text.match(/LOCATION:\s*(.+)\r?\n/i);
      if (match) locations.add(match[1].trim());
    });

    socket.bind(() => {
      socket.send(query, 0, query.length, 1900, '239.255.255.250');
      setTimeout(() => socket.send(query, 0, query.length, 1900, '239.255.255.250'), 1000);
    });

    setTimeout(async () => {
      socket.close();
      const devices = [];
      for (const location of locations) {
        try {
          const res = await fetch(location);
          const xml = await res.text();
          const friendlyName = (xml.match(/<friendlyName>(.*?)<\/friendlyName>/) || [])[1] || 'Dispositivo sconosciuto';
          const manufacturer = (xml.match(/<manufacturer>(.*?)<\/manufacturer>/) || [])[1] || '';
          const modelName = (xml.match(/<modelName>(.*?)<\/modelName>/) || [])[1] || '';
          const ip = new URL(location).hostname;
          devices.push({ ip, friendlyName, manufacturer, modelName });
        } catch {
          // ignorato
        }
      }
      resolve(devices);
    }, timeoutMs);
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

/* --- Scansione diretta della sottorete --- */
function getLocalSubnetBase() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address.split('.').slice(0, 3).join('.');
      }
    }
  }
  return null;
}

async function probeBravia(ip) {
  try {
    const res = await fetch(`http://${ip}/sony/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getPowerStatus', id: 1, params: [], version: '1.0' }),
      signal: AbortSignal.timeout(500),
    });
    const text = await res.text();
    if (text.includes('"result"') || text.includes('"error"')) {
      return { ip };
    }
  } catch {
    // ignorato
  }
  return null;
}

async function subnetScan(base, onProgress) {
  const found = [];
  let next = 1;
  const CONCURRENCY = 40;

  async function worker() {
    while (next <= 254) {
      const n = next++;
      if (onProgress) onProgress(n);
      const result = await probeBravia(`${base}.${n}`);
      if (result) found.push(result);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return found;
}

function loadTvConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveTvConfig(cfg) {
  // Preserva il MAC address se già presente nel file di configurazione esistente
  const existing = loadTvConfig();
  if (existing && existing.mac && !cfg.mac) {
    cfg.mac = existing.mac;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

async function setupTv() {
  const saved = loadTvConfig();
  if (saved && !process.env.FORCE_DISCOVER) {
    console.log(`TV configurata: ${saved.friendlyName || saved.ip} (${saved.ip})`);
    console.log('Per rifare la scansione, avvia con: FORCE_DISCOVER=1 node desktop-agent.js\n');
    return saved;
  }

  console.log('Scansione dispositivi sulla rete locale (SSDP) in corso...\n');
  let devices = await ssdpDiscover();

  if (devices.length === 0) {
    console.log('SSDP non ha trovato nulla. Provo una scansione diretta della sottorete...');
    const base = getLocalSubnetBase();
    if (base) {
      const found = await subnetScan(base, (n) => process.stdout.write(`\rProbing ${base}.${n}...  `));
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      devices = found.map((f) => ({ ip: f.ip, friendlyName: 'Sony Bravia (rilevato via API)', manufacturer: '', modelName: '' }));
    }
  }

  if (devices.length === 0) {
    console.log('Nessun dispositivo trovato con nessuno dei due metodi.');
    const ip = await ask('Inserisci manualmente l\'IP della TV: ');
    const cfg = { ip: ip.trim(), psk: '', friendlyName: 'TV (manuale)' };
    saveTvConfig(cfg);
    return cfg;
  }

  console.log('Dispositivi trovati:\n');
  devices.forEach((d, i) => {
    console.log(`  [${i + 1}] ${d.friendlyName}  (${d.manufacturer} ${d.modelName})  -  ${d.ip}`);
  });
  console.log('');

  const choice = await ask('Scegli il numero del dispositivo da collegare (o "m" per inserire IP manuale): ');

  let selected;
  if (choice.trim().toLowerCase() === 'm') {
    const ip = await ask('Inserisci manualmente l\'IP della TV: ');
    selected = { ip: ip.trim(), friendlyName: 'TV (manuale)' };
  } else {
    const idx = parseInt(choice.trim(), 10) - 1;
    selected = devices[idx];
    if (!selected) {
      console.log('Scelta non valida, riprova.');
      process.exit(1);
    }
  }

  const cfg = { ip: selected.ip, psk: '', friendlyName: selected.friendlyName };
  saveTvConfig(cfg);
  console.log(`\nSalvato: ${cfg.friendlyName} (${cfg.ip})\n`);
  return cfg;
}

/* --- Registrazione/autenticazione con la TV --- */
async function actRegister(ip, pin) {
  const body = JSON.stringify({
    method: 'actRegister',
    id: 1,
    params: [
      { clientid: 'FilebeamRemote:1', nickname: 'Filebeam Remote', level: 'private' },
      [{ value: 'yes', function: 'WOL' }],
    ],
    version: '1.0',
  });

  const headers = { 'Content-Type': 'application/json' };
  if (pin !== null) {
    headers['Authorization'] = 'Basic ' + Buffer.from(':' + pin).toString('base64');
  }

  const res = await fetch(`http://${ip}/sony/accessControl`, { method: 'POST', headers, body });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function authenticateWithTv(ip) {
  let result = await actRegister(ip, null);

  if (result.status === 200 && result.cookie) {
    console.log('TV gia\' autorizzata, nessun PIN necessario.');
    return result.cookie;
  }

  if (result.status === 401 || result.status === 403) {
    console.log('\nControlla lo schermo della TV: dovrebbe essere comparso un codice PIN.');
    const pin = await ask('Inserisci il PIN mostrato sulla TV: ');
    result = await actRegister(ip, pin.trim());
    if (result.status === 200 && result.cookie) {
      console.log('Registrazione completata.\n');
      return result.cookie;
    }
    console.log(`Registrazione fallita (HTTP ${result.status}). Riprova a riavviare l'agente.`);
    return null;
  }

  console.log(`Risposta inattesa dalla TV durante la registrazione (HTTP ${result.status}).`);
  return null;
}

/* --- MODALITÀ DIAGNOSTICA --- */
async function getRemoteControllerInfo() {
  if (!tv) return;
  const headers = { 'Content-Type': 'application/json' };
  if (tv.cookie) headers['Cookie'] = tv.cookie;
  else if (tv.psk) headers['X-Auth-PSK'] = tv.psk;

  try {
    console.log('\n================================================');
    console.log('  DIAGNOSTICA: Elenco codici IRCC supportati');
    console.log('================================================');
    
    const res = await fetch(`http://${tv.ip}/sony/system`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: 'getRemoteControllerInfo', id: 1, params: [], version: '1.0' }),
    });

    if (!res.ok) {
      console.error(`Errore HTTP dalla TV: ${res.status}`);
      return;
    }

    const json = await res.json();
    if (json.error) {
      console.error('La TV ha restituito un errore API:', json.error);
      return;
    }

    const commands = json.result && json.result[1];
    if (Array.isArray(commands)) {
      commands.forEach((cmd) => {
        console.log(`  ${cmd.name.padEnd(20)} ->  ${cmd.value}`);
      });
    } else {
      console.log('Struttura dati inattesa o nessun comando trovato:', JSON.stringify(json));
    }
    console.log('================================================\n');
  } catch (err) {
    console.error('Impossibile recuperare le info del telecomando:', err.message);
  }
}

// Mappa inversa codice -> nome, solo per log leggibili
const IRCC_NAMES = Object.fromEntries(Object.entries(IRCC).map(([name, code]) => [code, name]));

async function braviaJsonCall(endpoint, method, params, version = '1.0') {
  if (!tv) return;
  const headers = { 'Content-Type': 'application/json' };
  if (tv.cookie) headers['Cookie'] = tv.cookie;
  else if (tv.psk) headers['X-Auth-PSK'] = tv.psk;
  try {
    const res = await fetch(`http://${tv.ip}/sony/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, id: 1, params, version }),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`TV: ${endpoint}/${method} -> HTTP ${res.status} ${text.slice(0, 200)}`);
    } else {
      console.error(`TV: ${endpoint}/${method} -> HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`TV: errore chiamando ${endpoint}/${method}:`, err.message);
  }
}

async function braviaIrcc(code) {
  if (!tv) return;
  const label = IRCC_NAMES[code] || code;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>${code}</IRCCCode></u:X_SendIRCC></s:Body>
</s:Envelope>`;
  const headers = { 'Content-Type': 'text/xml; charset=UTF-8', SOAPACTION: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"' };
  if (tv.cookie) headers['Cookie'] = tv.cookie;
  else if (tv.psk) headers['X-Auth-PSK'] = tv.psk;
  try {
    const res = await fetch(`http://${tv.ip}/sony/IRCC`, { method: 'POST', headers, body });
    const text = await res.text();
    if (res.ok) {
      console.log(`TV: IRCC "${label}" -> HTTP ${res.status} ${text.slice(0, 200)}`);
    } else {
      console.error(`TV: IRCC "${label}" -> HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`TV: errore IRCC "${label}":`, err.message);
  }
}




let streamProcess = null;
/* --- ASSOCIAZIONE TASTI E AZIONI --- */
const ACTIONS = {


tv_mirroring: () => {
    if (process.platform === 'win32') {
      // Apre il pannello di sistema "Connetti" (Miracast), lo stesso di Win+K:
      // Windows gestisce da solo scoperta e streaming verso la TV.
      console.log('Apro il pannello "Connetti" di Windows per il mirroring wireless...');
      run('explorer.exe ms-availablenetworks:');
      return;
    }

    // Linux: cattura schermo con ffmpeg (richiede ffmpeg installato e X11).
    if (streamProcess) {
        console.log("Termino lo streaming...");
        streamProcess.kill();
        streamProcess = null;
    } else {
        console.log("Avvio cattura schermo per streaming DLNA...");
        streamProcess = spawn('ffmpeg', [
            '-f', 'x11grab', '-framerate', '24', '-video_size', '1920x1080',
            '-i', ':0.0', '-c:v', 'libx264', '-preset', 'ultrafast',
            '-f', 'mpegts', 'udp://127.0.0.1:1234'
        ]);
    }
},

  // --- COMANDI PC DESKTOP (Eseguiti localmente tramite bash) ---
  play_pause: () => run('playerctl play-pause || xdotool key XF86AudioPlay'),
  volume_up: () => run('pactl set-sink-volume @DEFAULT_SINK@ +5% || amixer -q sset Master 5%+'),
  volume_down: () => run('pactl set-sink-volume @DEFAULT_SINK@ -5% || amixer -q sset Master 5%-'),
  next: () => run('playerctl next || xdotool key XF86AudioNext'),
  prev: () => run('playerctl previous || xdotool key XF86AudioPrev'),

  // --- COMANDI TV (Sony Bravia) ---
  // Gestione intelligente dell'accensione: prima invia il pacchetto UDP di risveglio, poi fa la chiamata API standard
// --- COMANDI TV (Sony Bravia) ---
  
  // Gestione intelligente Toggle Power (Accensione/Spegnimento con rilevamento dello stato)
  tv_power: async () => {
    if (!tv) return;
    
    let isTvOn = false;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (tv.cookie) headers['Cookie'] = tv.cookie;
      else if (tv.psk) headers['X-Auth-PSK'] = tv.psk;

      // Interroga lo stato energetico della TV (timeout piu' largo: appena
      // uscita dalla standby la TV puo' rispondere con latenza).
      const res = await fetch(`http://${tv.ip}/sony/system`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'getPowerStatus', id: 1, params: [], version: '1.0' }),
        signal: AbortSignal.timeout(2500),
      });
      const data = await res.json();
      const status = data.result && data.result[0] && data.result[0].status;
      isTvOn = status === 'active';
      console.log(`[Power Toggle] Stato rilevato: ${status || 'sconosciuto'} (${JSON.stringify(data)})`);
    } catch (err) {
      // Se va in timeout o restituisce un errore di rete, significa che la TV è spenta o in standby profondo
      console.log(`[Power Toggle] Nessuna risposta dalla TV (${err.message}), presumo sia spenta.`);
      isTvOn = false;
    }

    if (isTvOn) {
      console.log("[Power Toggle] La TV è accesa. Invio spegnimento...");
      braviaIrcc(IRCC.power_off);
    } else {
      console.log("[Power Toggle] La TV è spenta. Invio pacchetti Wake-on-LAN e richiesta di accensione...");
      if (tv.mac) {
        // Un singolo pacchetto UDP puo' andare perso: ne inviamo 3 a breve distanza.
        sendBraviaWoL(tv.mac);
        setTimeout(() => sendBraviaWoL(tv.mac), 400);
        setTimeout(() => sendBraviaWoL(tv.mac), 1000);
      } else {
        console.log('[Power Toggle] Nessun MAC configurato in tv-config.json: impossibile inviare Wake-on-LAN.');
      }
      // Riprova la chiamata IP di accensione piu' volte: appena il WoL sveglia
      // il chip di rete la TV impiega qualche secondo prima di rispondere.
      braviaJsonCall('system', 'setPowerStatus', [{ status: true }]);
      setTimeout(() => braviaJsonCall('system', 'setPowerStatus', [{ status: true }]), 1500);
      setTimeout(() => braviaJsonCall('system', 'setPowerStatus', [{ status: true }]), 3500);
    }
  },

  // Mantieni comunque i metodi singoli di fallback se dovessero servirti
  tv_power_on: () => {
    if (tv && tv.mac) sendBraviaWoL(tv.mac);
    braviaJsonCall('system', 'setPowerStatus', [{ status: true }]);
  },
  tv_power_off: () => braviaIrcc(IRCC.power_off),
  tv_input: () => braviaIrcc(IRCC.input),
  tv_sync_menu: () => braviaIrcc(IRCC.sync_menu),
  tv_display: () => braviaIrcc(IRCC.display),
  
  // Direzionali
  tv_up: () => braviaIrcc(IRCC.up),
  tv_down: () => braviaIrcc(IRCC.down),
  tv_left: () => braviaIrcc(IRCC.left),
  tv_right: () => braviaIrcc(IRCC.right),
  tv_confirm: () => braviaIrcc(IRCC.confirm),
  
  tv_home: () => braviaIrcc(IRCC.home),
  tv_options: () => braviaIrcc(IRCC.options),
  tv_return: () => braviaIrcc(IRCC.return),
  tv_exit: () => braviaIrcc(IRCC.exit),

  // Tastierino
  tv_num1: () => braviaIrcc(IRCC.num1),
  tv_num2: () => braviaIrcc(IRCC.num2),
  tv_num3: () => braviaIrcc(IRCC.num3),
  tv_num4: () => braviaIrcc(IRCC.num4),
  tv_num5: () => braviaIrcc(IRCC.num5),
  tv_num6: () => braviaIrcc(IRCC.num6),
  tv_num7: () => braviaIrcc(IRCC.num7),
  tv_num8: () => braviaIrcc(IRCC.num8),
  tv_num9: () => braviaIrcc(IRCC.num9),
  tv_num0: () => braviaIrcc(IRCC.num0),
  tv_dot: () => braviaIrcc(IRCC.dot),
  tv_enter: () => braviaIrcc(IRCC.enter),

  // Volume e Audio
  tv_volume_up: () => braviaIrcc(IRCC.volume_up),
  tv_volume_down: () => braviaIrcc(IRCC.volume_down),
  tv_mute: () => braviaIrcc(IRCC.mute),
  tv_channel_up: () => braviaIrcc(IRCC.channel_up),
  tv_channel_down: () => braviaIrcc(IRCC.channel_down),

  // Tasti Colore
  tv_red: () => braviaIrcc(IRCC.red),
  tv_green: () => braviaIrcc(IRCC.green),
  tv_yellow: () => braviaIrcc(IRCC.yellow),
  tv_blue: () => braviaIrcc(IRCC.blue),

  // Player
  tv_play: () => braviaIrcc(IRCC.play),
  tv_pause: () => braviaIrcc(IRCC.pause),
  tv_stop: () => braviaIrcc(IRCC.stop),
  tv_rewind: () => braviaIrcc(IRCC.rewind),
  tv_forward: () => braviaIrcc(IRCC.forward),
  tv_prev: () => braviaIrcc(IRCC.prev),
  tv_next: () => braviaIrcc(IRCC.next),

  // Smart App
  tv_netflix: () => braviaIrcc(IRCC.netflix),
  tv_sen: () => braviaIrcc(IRCC.sen)
};

/* --- Avvio --- */
async function main() {
  tv = await setupTv();

  if (tv && !tv.cookie && !tv.psk) {
    console.log(`Autenticazione con la TV (${tv.ip})...`);
    const cookie = await authenticateWithTv(tv.ip);
    if (cookie) {
      tv.cookie = cookie;
      saveTvConfig(tv);
    }
  }

  // Il Wake-on-LAN richiede il MAC address: se manca (config vecchia o
  // scoperta automatica, che non lo rileva) proviamo a ricavarlo dalla
  // tabella ARP. Se la TV era gia' autenticata (cookie/psk presenti) non
  // abbiamo ancora scambiato pacchetti in questa sessione: facciamo un
  // probe HTTP leggero solo per "scaldare" la cache ARP del sistema.
  if (tv && !tv.mac) {
    if (tv.cookie || tv.psk) {
      try {
        await fetch(`http://${tv.ip}/sony/system`, { signal: AbortSignal.timeout(1500) });
      } catch {
        // ignorato: basta il tentativo di connessione per popolare l'ARP
      }
    }
    const mac = await getMacFromArp(tv.ip);
    if (mac) {
      tv.mac = mac;
      saveTvConfig(tv);
      console.log(`MAC address rilevato automaticamente: ${mac}`);
    } else {
      console.log('Impossibile rilevare automaticamente il MAC della TV: il Wake-on-LAN (accensione da spenta) non funzionera\'.');
      console.log(`Aggiungilo manualmente nel campo "mac" di tv-config.json (lo trovi nelle impostazioni di rete della TV).`);
    }
  }

  if (process.env.DIAGNOSTIC) {
    await getRemoteControllerInfo();
    console.log('Modalità diagnostica completata. Uscita.');
    process.exit(0);
  }

  const ws = new WebSocket(RELAY_URL);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'create' }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);

    if (msg.type === 'created') {
      console.log('\n=== Codice pairing: ' + msg.code + ' ===');
      console.log('Inserisci questo codice nell\'app mobile.\n');
    }

    if (msg.type === 'peer_connected') {
      console.log('Dispositivo mobile connesso.');
    }

    if (msg.type === 'peer_disconnected') {
      console.log('Dispositivo mobile disconnesso.');
    }

    if (msg.type === 'command') {
      const action = ACTIONS[msg.cmd];
      if (action) {
        console.log('Eseguo:', msg.cmd);
        action();
      } else {
        console.log('Comando sconosciuto:', msg.cmd);
      }
    }
  });

  ws.on('close', () => {
    console.log('Connessione al relay chiusa.');
  });

  ws.on('error', (err) => {
    console.error('Errore WebSocket:', err.message);
  });
}

main();