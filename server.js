const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// room_code -> { desktop: ws|null, mobile: ws|null }
const rooms = new Map();

// Ultimo codice di pairing creato: usato dall'app desktop (Electron) per
// aprire il telecomando gia' collegato, senza doverlo digitare a mano.
let lastCode = null;

function generateCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// --- Static file server ---
// I file vengono letti in memoria all'avvio con chiamate dirette e letterali
// (fs.readFileSync(path.join(__dirname, ...))) cosi' pkg le individua
// staticamente e le include nell'eseguibile. Il routing e' una whitelist
// fissa, non costruita da req.url, per evitare path traversal.
const mobileHtml = fs.readFileSync(path.join(__dirname, 'public/mobile.html'));

const server = http.createServer((req, res) => {
  // req.url include la query string (es. /mobile.html?code=123456):
  // confrontiamo solo il pathname, altrimenti il match fallisce.
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/pairing-code') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: lastCode }));
    return;
  }

  let body;
  if (pathname === '/' || pathname === '/mobile.html') {
    body = mobileHtml;
  } else {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(body);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null; // 'desktop' | 'mobile'

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'create') {
      // Desktop crea una nuova room
      const code = generateCode();
      rooms.set(code, { desktop: ws, mobile: null });
      ws.roomCode = code;
      ws.role = 'desktop';
      lastCode = code;
      send(ws, { type: 'created', code });
      return;
    }

    if (msg.type === 'join') {
      // Mobile si unisce a una room esistente
      const room = rooms.get(msg.code);
      if (!room || !room.desktop) {
        send(ws, { type: 'error', message: 'Codice non valido o desktop non connesso' });
        return;
      }
      room.mobile = ws;
      ws.roomCode = msg.code;
      ws.role = 'mobile';
      send(ws, { type: 'joined', code: msg.code });
      send(room.desktop, { type: 'peer_connected' });
      return;
    }

    if (msg.type === 'command' && ws.role === 'mobile') {
      const room = rooms.get(ws.roomCode);
      if (room && room.desktop) {
        send(room.desktop, { type: 'command', cmd: msg.cmd, value: msg.value });
      }
      return;
    }

    if (msg.type === 'status' && ws.role === 'desktop') {
      const room = rooms.get(ws.roomCode);
      if (room && room.mobile) {
        send(room.mobile, { type: 'status', text: msg.text });
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws.role === 'desktop') {
      send(room.mobile, { type: 'peer_disconnected' });
      rooms.delete(ws.roomCode);
    } else if (ws.role === 'mobile') {
      room.mobile = null;
      send(room.desktop, { type: 'peer_disconnected' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Relay in ascolto su http://localhost:${PORT}`);
});
