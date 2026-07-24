# Bravia Remote

Telecomando web per Sony Bravia (e non solo) che trasforma il tuo telefono in una dashboard di controllo per la TV e per il PC a cui è collegata. Nessuna app da installare sul telefono: si apre dal browser.

Il sistema è composto da tre pezzi che comunicano tra loro:

```
 [ Telefono ]  --- pagina web (mobile.html) ---\
                                                  >  [ Relay WebSocket ]  <-->  [ Agent sul PC ]  -->  TV / PC
 [ PC/Desktop] --- pagina web (desktop.html) --/
```

- **Relay** (`server.js`) — piccolo server che fa da ponte: genera un codice a 6 cifre e inoltra i comandi dal telefono all'agent.
- **Agent** (`desktop-agent.js`) — gira sul PC collegato alla TV. Trova la TV in rete (SSDP/scansione subnet), si autentica con l'API Sony Bravia (IRCC) ed esegue i comandi ricevuti: accensione/spegnimento (con Wake-on-LAN), volume, canali, tastierino numerico, navigazione, tasti colorati, app smart (Netflix/SEN) e mirroring dello schermo.
- **Pagine web** (`public/desktop.html`, `public/mobile.html`) — l'interfaccia: `desktop.html` mostra il codice di pairing, `mobile.html` è il vero e proprio telecomando touch.

## Download

Vai alla sezione [Releases](../../releases) e scarica gli eseguibili per Windows (non serve installare Node.js):

- **`bravia-remote-server.exe`** — avvia il relay e serve le pagine web su `http://localhost:3000`
- **`bravia-remote-agent.exe`** — l'agent che gira accanto alla TV/PC da controllare

## Come usarlo

1. Sul PC collegato alla TV, avvia **`bravia-remote-server.exe`**. Resta in ascolto su `http://localhost:3000`.
2. Nella stessa cartella (o su un altro PC nella stessa rete), avvia **`bravia-remote-agent.exe`**. Al primo avvio scansiona la rete locale per trovare la TV Sony Bravia — se non la trova automaticamente, puoi inserire l'IP manualmente. Il risultato viene salvato in `tv-config.json` accanto all'eseguibile.
3. Apri `http://localhost:3000` sul PC: comparirà un **codice a 6 cifre**.
4. Dal telefono (connesso alla stessa rete WiFi), apri `http://<IP-DEL-PC>:3000/mobile.html`, inserisci il codice e collegati.
5. Controlla la TV e il PC dal telefono.

> Se l'agent gira su un PC diverso da quello che ospita il relay, imposta la variabile d'ambiente `RELAY_URL` (es. `RELAY_URL=ws://192.168.1.10:3000`) prima di avviarlo.

### Nota sui controlli multimediali del PC

I comandi di play/pausa/volume del PC (`playerctl`, `xdotool`, `pactl`, `amixer`) sono pensati per Linux. Su Windows funzionano solo i comandi TV (accensione, IRCC, ecc.) — i tasti media/volume del PC non hanno ancora un equivalente Windows.

## Sicurezza

`tv-config.json` contiene l'IP, il MAC address e il cookie di autenticazione della tua TV: **non condividerlo né versionarlo**. Il repository ignora già questo file (vedi `.gitignore`); usa `tv-config.example.json` come riferimento del formato.

## Build da sorgente

Richiede [Node.js](https://nodejs.org/) 18+.

```bash
npm install

npm start          # avvia il relay (server.js) in locale
npm run agent      # avvia l'agent (desktop-agent.js) in locale

npm run build       # genera entrambi gli eseguibili Windows in dist/
```

## Licenza

[MIT](LICENSE)
