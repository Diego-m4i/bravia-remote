// Converte assets/icon.png in assets/icon.ico (formato ICO con PNG
// incorporato, supportato da Windows Vista in poi) senza dipendenze esterne.
const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');
const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');

const png = fs.readFileSync(pngPath);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // numero immagini

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // larghezza: 0 = 256px
entry.writeUInt8(0, 1); // altezza: 0 = 256px
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bit depth
entry.writeUInt32LE(png.length, 8); // dimensione dati immagine
entry.writeUInt32LE(header.length + entry.length, 12); // offset dati

fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log('icon.ico creata:', icoPath);
