import fs from 'node:fs';
import path from 'node:path';

const requireFile = (relative) => {
  const file = path.resolve(relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing packaged resource: ${relative}`);
  if (fs.statSync(file).size < 64) throw new Error(`Empty or invalid resource: ${relative}`);
  return fs.readFileSync(file);
};
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512]) {
  const png = requireFile(`assets/icons/png/${size}x${size}.png`);
  if (!png.subarray(0, 8).equals(pngHeader)) throw new Error(`Linux ${size}x${size} icon is not PNG`);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Linux ${size}x${size} icon has unexpected dimensions`);
}
const appIcon = requireFile('assets/icons/png/app-icon-512.png');
if (!appIcon.subarray(0, 8).equals(pngHeader) || appIcon.readUInt32BE(16) !== 512 || appIcon.readUInt32BE(20) !== 512)
  throw new Error('Application icon must be a 512x512 PNG');
const ico = requireFile('assets/icons/ico/SOUL-M8TE.ico');
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 1)
  throw new Error('Windows icon is not a valid ICO container');
requireFile('src/renderer/assets/soul/chloe-wallpaper.webp');
const pkg = JSON.parse(requireFile('package.json').toString('utf8'));
const lock = JSON.parse(requireFile('package-lock.json').toString('utf8'));
if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version)
  throw new Error('package.json and package-lock.json versions differ');
if (pkg.build?.linux?.icon !== 'assets/icons/png')
  throw new Error('Unexpected Linux icon packaging path');
console.log(`soulm8te ${pkg.version}: icons, wallpapers and version metadata verified`);
