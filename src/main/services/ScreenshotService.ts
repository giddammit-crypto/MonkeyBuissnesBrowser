import { ClipboardItem, clipboard, dialog, nativeImage, type BaseWindow, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';

const pngPrefix = 'data:image/png;base64,';
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxBytes = 32 * 1024 * 1024;
const maxPixels = 12_000_000;

export interface TabScreenshot {
  dataUrl: string;
  width: number;
  height: number;
}

export async function captureTabScreenshot(contents: WebContents): Promise<TabScreenshot> {
  let image = await contents.capturePage(undefined, { stayHidden: true });
  if (image.isEmpty()) throw new Error('Страница пока недоступна для снимка.');
  const bitmap = image.toPNG();
  const width = bitmap.readUInt32BE(16);
  const height = bitmap.readUInt32BE(20);
  const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  if (scale < 1) {
    const size = image.getSize();
    image = image.resize({ width: Math.max(1, Math.floor(size.width * scale)) });
  }
  const png = scale < 1 ? image.toPNG() : bitmap;
  if (png.length > maxBytes) throw new Error('Снимок слишком большой.');
  return { dataUrl: pngPrefix + png.toString('base64'), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function decodePng(dataUrl: unknown): Buffer {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(pngPrefix) || dataUrl.length > pngPrefix.length + Math.ceil(maxBytes / 3) * 4) {
    throw new Error('Некорректный или слишком большой снимок.');
  }
  const png = Buffer.from(dataUrl.slice(pngPrefix.length), 'base64');
  if (png.length < 33 || png.length > maxBytes || !png.subarray(0, 8).equals(pngSignature) || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Поддерживаются только снимки PNG.');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > maxPixels) {
    throw new Error('Размер снимка превышает допустимый.');
  }
  return png;
}

export async function exportScreenshot(owner: BaseWindow, dataUrl: unknown, action: unknown): Promise<boolean> {
  if (action !== 'copy' && action !== 'save') throw new Error('Неизвестное действие со снимком.');
  const image = nativeImage.createFromBuffer(decodePng(dataUrl));
  if (image.isEmpty()) throw new Error('Не удалось прочитать снимок.');
  if (action === 'copy') {
    const png = new Blob([Uint8Array.from(image.toPNG())], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  }
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    title: 'Сохранить снимок',
    defaultPath: `soulm8te-${timestamp}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath) return false;
  await writeFile(filePath, image.toPNG());
  return true;
}
