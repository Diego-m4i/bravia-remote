# Bravia Remote

Telecomando web per Sony Bravia (e non solo) che trasforma il tuo telefono in una dashboard di controllo per la TV e per il PC a cui è collegata. Nessuna app da installare sul telefono: si apre dal browser.

Il sistema è composto da tre pezzi che comunicano tra loro:

```
 [ Telefono o browser PC ]  --- pagina web (mobile.html) ---  [ Relay WebSocket ]  <-->  [ Agent sul PC ]  -->  TV / PC
```

- **Relay** (`server.js`) — piccolo server che fa da ponte: inoltra i comandi dalla pagina web all'agent, e serve `mobile.html`.
- **Agent** (`desktop-agent.js`) — gira sul PC collegato alla TV. Trova la TV in rete (SSDP/scansione subnet), si autentica con l'API Sony Bravia (IRCC) ed esegue i comandi ricevuti: accensione/spegnimento (con Wake-on-LAN), volume, canali, tastierino numerico, navigazione, tasti colorati, app smart (Netflix/SEN) e mirroring dello schermo. All'avvio genera un **codice di pairing a 6 cifre**, stampato nella sua finestra di console.
- **Pagina web** (`public/mobile.html`) — il telecomando touch: si apre nel browser (telefono o PC) e si collega inserendo il codice mostrato dall'agent.

## Download

Vai alla sezione [Releases](../../releases) e scarica gli eseguibili per Windows (non serve installare Node.js):

- **`bravia-remote-server.exe`** — avvia il relay e serve le pagine web su `http://localhost:3000`
- **`bravia-remote-agent.exe`** — l'agent che gira accanto alla TV/PC da controllare

## Come usarlo

1. Sul PC collegato alla TV, avvia **`bravia-remote-server.exe`**. Resta in ascolto su `http://localhost:3000`.
2. Nella stessa cartella (o su un altro PC nella stessa rete), avvia **`bravia-remote-agent.exe`**. Al primo avvio scansiona la rete locale per trovare la TV Sony Bravia — se non la trova automaticamente, puoi inserire l'IP manualmente. Il risultato viene salvato in `tv-config.json` accanto all'eseguibile. Quando è pronto, la finestra di console mostra un **codice a 6 cifre**.
3. Apri `http://localhost:3000/mobile.html` sul PC, oppure dal telefono (stessa rete WiFi) `http://<IP-DEL-PC>:3000/mobile.html`, inserisci il codice e collegati.
4. Controlla la TV (e il PC, su Linux) dalla pagina.

> Se l'agent gira su un PC diverso da quello che ospita il relay, imposta la variabile d'ambiente `RELAY_URL` (es. `RELAY_URL=ws://192.168.1.10:3000`) prima di avviarlo.

### Condivisione schermo

Il pulsante "Condividi Schermo" su Windows apre il pannello di sistema **Connetti** (lo stesso di `Win+K`): scegli la TV dalla lista e Windows gestisce da solo lo streaming Miracast. Su Linux tenta invece una cattura con `ffmpeg` (richiede `ffmpeg` installato).

### Nota sui controlli multimediali del PC

I comandi di play/pausa/volume del PC (`playerctl`, `xdotool`, `pactl`, `amixer`) sono pensati per Linux. Su Windows funzionano solo i comandi TV (accensione, IRCC, ecc.) — i tasti media/volume del PC non hanno ancora un equivalente Windows.

### Diagnosticare comandi che non rispondono

Se premendo un tasto la TV non reagisce, guarda la finestra di console dell'agent: ogni comando TV stampa la risposta HTTP ricevuta (o l'errore). Per un elenco completo dei codici IRCC effettivamente supportati dalla tua TV, avvia l'agent con la modalità diagnostica:

```bash
# da sorgente
DIAGNOSTIC=1 node desktop-agent.js

# eseguibile (PowerShell)
$env:DIAGNOSTIC = "1"; .\bravia-remote-agent.exe
```

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
