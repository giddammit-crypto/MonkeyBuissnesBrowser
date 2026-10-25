import fs from 'node:fs';
import path from 'node:path';

const requireFile = (relative) => {
  const file = path.resolve(relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing packaged resource: ${relative}`);
  if (fs.statSync(file).size < 64) throw new Error(`Empty or invalid resource: ${relative}`);
  return fs.readFileSync(file);
};
const png = requireFile('assets/icons/png/app-icon-512.png');
if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Linux icon is not PNG');
const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20);
if (pngWidth < 256 || pngHeight < 256) throw new Error('Linux icon needs at least 256x256');
const ico = requireFile('assets/icons/ico/SOUL-M8TE.ico');
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 1)
  throw new Error('Windows icon is not a valid ICO container');
requireFile('src/renderer/assets/soul/chloe-wallpaper.webp');
const pkg = JSON.parse(requireFile('package.json').toString('utf8'));
const lock = JSON.parse(requireFile('package-lock.json').toString('utf8'));
if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version)
  throw new Error('package.json and package-lock.json versions differ');
if (pkg.build?.linux?.icon !== 'assets/icons/png/app-icon-512.png')
  throw new Error('Unexpected Linux icon packaging path');
console.log(`SOUL-M8TE ${pkg.version}: icons, wallpapers and version metadata verified`);
