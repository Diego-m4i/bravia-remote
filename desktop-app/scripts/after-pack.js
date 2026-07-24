// Hook electron-builder: incorpora l'icona nell'exe pacchettizzato con
// rcedit standalone (a differenza del rcedit incluso in winCodeSign,
// questo pacchetto contiene solo binari Windows: nessun symlink macOS
// che fallisce in estrazione per mancanza di privilegi su Windows).
const path = require('path');
const { rcedit } = require('rcedit');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exePath, { icon: path.join(__dirname, '..', 'assets', 'icon.ico') });
  console.log('Icona incorporata in', exePath);
};
