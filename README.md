# Bravia Remote

Telecomando web per Sony Bravia (e non solo) che trasforma il tuo telefono in una dashboard di controllo per la TV e per il PC a cui è collegata. Nessuna app da installare sul telefono: si apre dal browser.

Il sistema è composto da tre pezzi che comunicano tra loro:

```
 [ Telefono o browser PC ]  --- pagina web (mobile.html) ---  [ Relay WebSocket ]  <-->  [ Agent sul PC ]  -->  TV / PC
```

- **Relay** (`server.js`) — piccolo server che fa da ponte: inoltra i comandi dalla pagina web all'agent, e serve `mobile.html`.
- **Agent** (`desktop-agent.js`) — gira sul PC collegato alla TV. Trova la TV in rete (SSDP/scansione subnet), si autentica con l'API Sony Bravia (IRCC) ed esegue i comandi ricevuti: accensione/spegnimento (con Wake-on-LAN), volume, canali, tastierino numerico, navigazione, tasti colorati, app smart (Netflix/SEN). All'avvio genera un **codice di pairing a 6 cifre**, stampato nella sua finestra di console.
- **Pagina web** (`public/mobile.html`) — il telecomando touch: si apre nel browser (telefono o PC) e si collega inserendo il codice mostrato dall'agent.

**`desktop-app/`** impacchetta relay + agent in un'unica app desktop (Electron): apre una finestra dedicata gia' collegata al telecomando, senza passare dal browser ne' digitare codici.

## Download

Vai alla sezione [Releases](../../releases) e scarica l'eseguibile per Windows che preferisci (non serve installare Node.js):

- **`BraviaRemote-Setup.exe`** — **app unica consigliata**: un installer tradizionale (procedura guidata, scelta cartella, collegamento nel menu Start, disinstallabile da Windows come qualsiasi altro programma). Una volta installata, apre direttamente la finestra del telecomando, gia' collegata — nessun browser, nessun codice da digitare.
- **`bravia-remote-server.exe`** + **`bravia-remote-agent.exe`** — versione classica a due processi separati, utile se vuoi il relay su un PC e l'agent su un altro (es. telefono in un'altra stanza rispetto al PC/TV).

> **Avviso di Windows ("Editore sconosciuto" / SmartScreen):** questi eseguibili non sono firmati con un certificato a pagamento, quindi Windows mostra un avviso al primo avvio. E' normale per software indipendente distribuito cosi': clicca **"Ulteriori informazioni" -> "Esegui comunque"**. Se vuoi verificare l'origine, il codice sorgente e la build sono qui in questo repository pubblico.

## Come usarlo

### App unica (consigliata)

Scarica ed esegui **`BraviaRemote-Setup.exe`**, segui la procedura guidata (si installa solo per il tuo utente, non serve essere amministratore). A installazione completata parte da sola e apre subito la finestra del telecomando; la trovi anche nel menu Start e sul desktop per le volte successive. Al primo avvio, se la TV non viene trovata automaticamente in rete, modifica `tv-config.json` nella cartella `%APPDATA%\bravia-remote-app` con l'IP della TV (vedi `tv-config.example.json`) e riavvia.

### Versione classica (due eseguibili)

1. Sul PC collegato alla TV, avvia **`bravia-remote-server.exe`**. Resta in ascolto su `http://localhost:3000`.
2. Nella stessa cartella (o su un altro PC nella stessa rete), avvia **`bravia-remote-agent.exe`**. Al primo avvio scansiona la rete locale per trovare la TV Sony Bravia — se non la trova automaticamente, puoi inserire l'IP manualmente. Il risultato viene salvato in `tv-config.json` accanto all'eseguibile. Quando è pronto, la finestra di console mostra un **codice a 6 cifre**.
3. Apri `http://localhost:3000/mobile.html` sul PC, oppure dal telefono (stessa rete WiFi) `http://<IP-DEL-PC>:3000/mobile.html`, inserisci il codice e collegati.
4. Controlla la TV (e il PC, su Linux) dalla pagina.

> Se l'agent gira su un PC diverso da quello che ospita il relay, imposta la variabile d'ambiente `RELAY_URL` (es. `RELAY_URL=ws://192.168.1.10:3000`) prima di avviarlo.

### Accensione da spenta (Wake-on-LAN)

La maggior parte delle Bravia si accende via rete solo con un pacchetto Wake-on-LAN, non con la normale chiamata API — serve quindi il MAC address della TV. L'agent prova a rilevarlo da solo dalla tabella ARP del sistema operativo dopo il primo contatto con la TV; se non ci riesce (es. TV su una subnet diversa), aggiungilo a mano nel campo `"mac"` di `tv-config.json` (formato `AA:BB:CC:DD:EE:FF`, lo trovi nelle impostazioni di rete della TV). Verifica anche che sulla TV sia attiva l'opzione **Wake on LAN** (Impostazioni > Rete).

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

npm run build       # genera i due eseguibili Windows classici in dist/
```

Per l'app unica (Electron):

```bash
cd desktop-app
npm install
npm start          # avvia l'app in modalita' sviluppo
npm run dist        # genera dist-electron/BraviaRemote-Setup.exe
```

## Licenza

[MIT](LICENSE)
