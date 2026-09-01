// Pads assets/logo.png (130x97) onto a transparent 256x256 canvas and writes
// build/icon.ico — Windows wants a square icon and NSIS needs .ico, not .png.
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico');

const SRC = path.join(__dirname, '..', '..', 'assets', 'logo.png');
const OUT_DIR = path.join(__dirname, '..', '..', 'build');
const OUT_PNG = path.join(OUT_DIR, 'icon-256.png');
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');
const SIZE = 256;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const logo = await Jimp.read(SRC);
  const scale = Math.min(SIZE / logo.bitmap.width, SIZE / logo.bitmap.height);
  logo.scale(scale);

  const canvas = new Jimp(SIZE, SIZE, 0x00000000);
  canvas.composite(logo, Math.round((SIZE - logo.bitmap.width) / 2), Math.round((SIZE - logo.bitmap.height) / 2));
  await canvas.writeAsync(OUT_PNG);

  const ico = await pngToIco(OUT_PNG);
  fs.writeFileSync(OUT_ICO, ico);
  console.log('Wrote', OUT_ICO);
}

main().catch(err => { console.error(err); process.exit(1); });
