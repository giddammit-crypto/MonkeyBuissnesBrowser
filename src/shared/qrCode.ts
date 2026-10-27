/**
 * Standalone QR Code (ISO/IEC 18004) Matrix & SVG Generator.
 * Implements byte-mode encoding, Reed-Solomon error correction (levels L & M),
 * penalty-based optimal mask evaluation, and crisp vector SVG rendering.
 */

export type QrErrorCorrectionLevel = 'L' | 'M';

// Galois Field GF(256) tables with primitive polynomial 0x11D (285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    EXP_TABLE[i + 255] = val;
    LOG_TABLE[val] = i;
    val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
  }
  LOG_TABLE[0] = 0;
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMultiply(poly[j], factor);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsCompute(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const remainder = new Uint8Array(ecCount);

  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMultiply(gen[gen.length - 2 - j], factor);
    }
    remainder[ecCount - 1] = gfMultiply(gen[0], factor);
  }
  return remainder;
}

// Table of versions 1 to 40 EC parameters: [totalCodewords, ecCountPerBlock, numBlocksGroup1, dataCountGroup1, numBlocksGroup2, dataCountGroup2]
interface VersionEcSpec {
  totalCodewords: number;
  ecCount: number;
  blocks1: number;
  data1: number;
  blocks2: number;
  data2: number;
}

const EC_SPECS_L: Record<number, VersionEcSpec> = {
  1: { totalCodewords: 26, ecCount: 7, blocks1: 1, data1: 19, blocks2: 0, data2: 0 },
  2: { totalCodewords: 44, ecCount: 10, blocks1: 1, data1: 34, blocks2: 0, data2: 0 },
  3: { totalCodewords: 70, ecCount: 15, blocks1: 1, data1: 55, blocks2: 0, data2: 0 },
  4: { totalCodewords: 100, ecCount: 20, blocks1: 1, data1: 80, blocks2: 0, data2: 0 },
  5: { totalCodewords: 134, ecCount: 26, blocks1: 1, data1: 108, blocks2: 0, data2: 0 },
  6: { totalCodewords: 172, ecCount: 18, blocks1: 2, data1: 68, blocks2: 0, data2: 0 },
  7: { totalCodewords: 196, ecCount: 20, blocks1: 2, data1: 78, blocks2: 0, data2: 0 },
  8: { totalCodewords: 242, ecCount: 24, blocks1: 2, data1: 97, blocks2: 0, data2: 0 },
  9: { totalCodewords: 292, ecCount: 30, blocks1: 2, data1: 116, blocks2: 0, data2: 0 },
  10: { totalCodewords: 346, ecCount: 18, blocks1: 2, data1: 68, blocks2: 2, data2: 69 },
  11: { totalCodewords: 404, ecCount: 20, blocks1: 4, data1: 81, blocks2: 0, data2: 0 },
  12: { totalCodewords: 466, ecCount: 24, blocks1: 2, data1: 92, blocks2: 2, data2: 93 },
  13: { totalCodewords: 532, ecCount: 26, blocks1: 4, data1: 107, blocks2: 0, data2: 0 },
  14: { totalCodewords: 581, ecCount: 30, blocks1: 3, data1: 115, blocks2: 1, data2: 116 },
  15: { totalCodewords: 655, ecCount: 22, blocks1: 5, data1: 87, blocks2: 1, data2: 88 },
  16: { totalCodewords: 733, ecCount: 24, blocks1: 5, data1: 98, blocks2: 1, data2: 99 },
  17: { totalCodewords: 815, ecCount: 28, blocks1: 1, data1: 107, blocks2: 5, data2: 108 },
  18: { totalCodewords: 901, ecCount: 30, blocks1: 5, data1: 120, blocks2: 1, data2: 121 },
  19: { totalCodewords: 991, ecCount: 28, blocks1: 3, data1: 113, blocks2: 4, data2: 114 },
  20: { totalCodewords: 1085, ecCount: 28, blocks1: 3, data1: 107, blocks2: 5, data2: 108 },
};

const EC_SPECS_M: Record<number, VersionEcSpec> = {
  1: { totalCodewords: 26, ecCount: 10, blocks1: 1, data1: 16, blocks2: 0, data2: 0 },
  2: { totalCodewords: 44, ecCount: 16, blocks1: 1, data1: 28, blocks2: 0, data2: 0 },
  3: { totalCodewords: 70, ecCount: 26, blocks1: 1, data1: 44, blocks2: 0, data2: 0 },
  4: { totalCodewords: 100, ecCount: 18, blocks1: 2, data1: 32, blocks2: 0, data2: 0 },
  5: { totalCodewords: 134, ecCount: 24, blocks1: 2, data1: 43, blocks2: 0, data2: 0 },
  6: { totalCodewords: 172, ecCount: 16, blocks1: 4, data1: 27, blocks2: 0, data2: 0 },
  7: { totalCodewords: 196, ecCount: 18, blocks1: 4, data1: 31, blocks2: 0, data2: 0 },
  8: { totalCodewords: 242, ecCount: 22, blocks1: 2, data1: 38, blocks2: 2, data2: 39 },
  9: { totalCodewords: 292, ecCount: 22, blocks1: 3, data1: 36, blocks2: 2, data2: 37 },
  10: { totalCodewords: 346, ecCount: 26, blocks1: 4, data1: 43, blocks2: 1, data2: 44 },
  11: { totalCodewords: 404, ecCount: 30, blocks1: 1, data1: 50, blocks2: 4, data2: 51 },
  12: { totalCodewords: 466, ecCount: 22, blocks1: 6, data1: 58, blocks2: 2, data2: 59 },
  13: { totalCodewords: 532, ecCount: 22, blocks1: 8, data1: 53, blocks2: 4, data2: 54 },
  14: { totalCodewords: 581, ecCount: 24, blocks1: 4, data1: 56, blocks2: 5, data2: 57 },
  15: { totalCodewords: 655, ecCount: 24, blocks1: 5, data1: 54, blocks2: 5, data2: 55 },
  16: { totalCodewords: 733, ecCount: 28, blocks1: 7, data1: 73, blocks2: 3, data2: 74 },
  17: { totalCodewords: 815, ecCount: 28, blocks1: 10, data1: 72, blocks2: 1, data2: 73 },
  18: { totalCodewords: 901, ecCount: 26, blocks1: 9, data1: 74, blocks2: 4, data2: 75 },
  19: { totalCodewords: 991, ecCount: 26, blocks1: 3, data1: 70, blocks2: 11, data2: 71 },
  20: { totalCodewords: 1085, ecCount: 26, blocks1: 3, data1: 69, blocks2: 13, data2: 70 },
};

// Alignment pattern locations for versions 1 to 20
const ALIGNMENT_PATTERNS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
};

// Remainder bits per version
const REMAINDER_BITS: Record<number, number> = {
  1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0,
  11: 0, 12: 0, 13: 0, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 3, 20: 3,
};

function selectVersion(byteLength: number, ecLevel: QrErrorCorrectionLevel): { version: number; spec: VersionEcSpec } {
  const specs = ecLevel === 'L' ? EC_SPECS_L : EC_SPECS_M;
  for (let v = 1; v <= 20; v++) {
    const spec = specs[v];
    const totalData = spec.blocks1 * spec.data1 + spec.blocks2 * spec.data2;
    // Header: 4 bits mode + (v < 10 ? 8 : 16) bits length
    const headerBits = 4 + (v < 10 ? 8 : 16);
    const availableDataBytes = Math.floor((totalData * 8 - headerBits) / 8);
    if (byteLength <= availableDataBytes) {
      return { version: v, spec };
    }
  }
  throw new Error(`Data too long for QR Code generator (${byteLength} bytes)`);
}

class BitBuffer {
  private buffer: number[] = [];
  private length = 0;

  put(num: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.putBit(((num >>> i) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const byteIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= byteIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[byteIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }

  get(index: number): boolean {
    const byteIndex = Math.floor(index / 8);
    return ((this.buffer[byteIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  getLength(): number {
    return this.length;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

function encodeData(text: string, version: number, spec: VersionEcSpec): Uint8Array {
  const utf8 = new TextEncoder().encode(text);
  const totalDataBytes = spec.blocks1 * spec.data1 + spec.blocks2 * spec.data2;
  const buffer = new BitBuffer();

  // Mode indicator: 0100 (8-bit Byte mode)
  buffer.put(0b0100, 4);

  // Character count indicator
  const charCountBits = version < 10 ? 8 : 16;
  buffer.put(utf8.length, charCountBits);

  // Data payload
  for (let i = 0; i < utf8.length; i++) {
    buffer.put(utf8[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const remainingBits = totalDataBytes * 8 - buffer.getLength();
  const termLength = Math.min(4, Math.max(0, remainingBits));
  buffer.put(0, termLength);

  // Align to byte boundary
  while (buffer.getLength() % 8 !== 0) {
    buffer.putBit(false);
  }

  // Pad bytes: alternating 0xEC and 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (buffer.getLength() < totalDataBytes * 8) {
    buffer.put(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const dataBytes = buffer.getBytes();

  // Break data into blocks and calculate Reed-Solomon codes
  const blocks: Array<{ data: Uint8Array; ec: Uint8Array }> = [];
  let offset = 0;

  for (let i = 0; i < spec.blocks1; i++) {
    const slice = dataBytes.subarray(offset, offset + spec.data1);
    offset += spec.data1;
    blocks.push({ data: slice, ec: rsCompute(slice, spec.ecCount) });
  }

  for (let i = 0; i < spec.blocks2; i++) {
    const slice = dataBytes.subarray(offset, offset + spec.data2);
    offset += spec.data2;
    blocks.push({ data: slice, ec: rsCompute(slice, spec.ecCount) });
  }

  // Interleave data codewords
  const result: number[] = [];
  const maxDataLen = Math.max(spec.data1, spec.data2);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blocks[b].data.length) {
        result.push(blocks[b].data[i]);
      }
    }
  }

  // Interleave error correction codewords
  for (let i = 0; i < spec.ecCount; i++) {
    for (let b = 0; b < blocks.length; b++) {
      result.push(blocks[b].ec[i]);
    }
  }

  return new Uint8Array(result);
}

// BCH Format Info (15 bits): 5 data bits (2 bits EC level + 3 bits mask) + 10 error bits
const FORMAT_INFO_POLY = 0x537;
const FORMAT_INFO_MASK = 0x5412;

function getFormatInfo(ecLevel: QrErrorCorrectionLevel, mask: number): number {
  // EC Level: L = 01, M = 00
  const ecBits = ecLevel === 'L' ? 0b01 : 0b00;
  let data = (ecBits << 3) | mask;
  let bch = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((bch >>> (i + 10)) & 1) {
      bch ^= FORMAT_INFO_POLY << i;
    }
  }
  return ((data << 10) | bch) ^ FORMAT_INFO_MASK;
}

// Mask evaluation formulas
function isMasked(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

function calculatePenalty(matrix: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: 5+ consecutive same color modules in row/col
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        count++;
      } else {
        if (count >= 5) penalty += 3 + (count - 5);
        count = 1;
      }
    }
    if (count >= 5) penalty += 3 + (count - 5);
  }

  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        count++;
      } else {
        if (count >= 5) penalty += 3 + (count - 5);
        count = 1;
      }
    }
    if (count >= 5) penalty += 3 + (count - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = matrix[r][c];
      if (color === matrix[r + 1][c] && color === matrix[r][c + 1] && color === matrix[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  // Rule 3: 1:1:3:1:1 pattern
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 7; c++) {
      if (
        matrix[r][c] &&
        !matrix[r][c + 1] &&
        matrix[r][c + 2] &&
        matrix[r][c + 3] &&
        matrix[r][c + 4] &&
        !matrix[r][c + 5] &&
        matrix[r][c + 6]
      ) {
        if (c >= 4 && !matrix[r][c - 1] && !matrix[r][c - 2] && !matrix[r][c - 3] && !matrix[r][c - 4]) {
          penalty += 40;
        } else if (c + 10 < size && !matrix[r][c + 7] && !matrix[r][c + 8] && !matrix[r][c + 9] && !matrix[r][c + 10]) {
          penalty += 40;
        }
      }
    }
  }

  // Rule 4: Balance of dark vs light modules
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) darkCount++;
    }
  }
  const ratio = (darkCount / (size * size)) * 100;
  const deviation = Math.abs(ratio - 50);
  penalty += Math.floor(deviation / 5) * 10;

  return penalty;
}

/**
 * Generates a full boolean[][] QR Code matrix according to ISO/IEC 18004.
 * @param text The string to encode (usually a URL).
 * @param ecLevel Error correction level ('L' or 'M', default 'M').
 */
export function generateQrMatrix(text: string, ecLevel: QrErrorCorrectionLevel = 'M'): boolean[][] {
  const utf8 = new TextEncoder().encode(text);
  const { version, spec } = selectVersion(utf8.length, ecLevel);
  const size = 17 + version * 4;

  // Reserved mask: true if module is a function pattern / reserved
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const baseMatrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const markReserved = (r: number, c: number, value: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      reserved[r][c] = true;
      baseMatrix[r][c] = value;
    }
  };

  // 1. Finder patterns (7x7) + separators
  const placeFinder = (startRow: number, startCol: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = startRow + r;
        const col = startCol + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          markReserved(row, col, isBorder || isCenter);
        } else {
          markReserved(row, col, false); // separator
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 2. Alignment patterns (5x5)
  const alignCoords = ALIGNMENT_PATTERNS[version] || [];
  for (const ar of alignCoords) {
    for (const ac of alignCoords) {
      // Skip if overlaps finder patterns
      if ((ar < 8 && ac < 8) || (ar < 8 && ac > size - 9) || (ar > size - 9 && ac < 8)) {
        continue;
      }
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isBlack = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          markReserved(ar + r, ac + c, isBlack);
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    markReserved(6, i, i % 2 === 0);
    markReserved(i, 6, i % 2 === 0);
  }

  // 4. Dark module
  markReserved(4 * version + 9, 8, true);

  // 5. Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (i !== 6) markReserved(8, i, false);
    if (i !== 6) markReserved(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    markReserved(8, size - 1 - i, false);
    markReserved(size - 1 - i, 8, false);
  }

  // Encode data bits
  const rawData = encodeData(text, version, spec);
  const dataBits: boolean[] = [];
  for (let i = 0; i < rawData.length; i++) {
    for (let b = 7; b >= 0; b--) {
      dataBits.push(((rawData[i] >>> b) & 1) === 1);
    }
  }
  const remBits = REMAINDER_BITS[version] || 0;
  for (let i = 0; i < remBits; i++) {
    dataBits.push(false);
  }

  // Layout data bits zigzag right-to-left
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // skip timing pattern column
    const left = right - 1;

    const rowStart = upward ? size - 1 : 0;
    const rowEnd = upward ? -1 : size;
    const rowStep = upward ? -1 : 1;

    for (let r = rowStart; r !== rowEnd; r += rowStep) {
      for (const c of [right, left]) {
        if (!reserved[r][c]) {
          baseMatrix[r][c] = bitIdx < dataBits.length ? dataBits[bitIdx++] : false;
        }
      }
    }
    upward = !upward;
  }

  // Find the best mask (minimal penalty)
  let bestMask = 0;
  let minPenalty = Infinity;
  let bestMatrix: boolean[][] = [];

  for (let mask = 0; mask < 8; mask++) {
    const candidate: boolean[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => {
        if (reserved[r][c]) {
          return baseMatrix[r][c];
        }
        return isMasked(mask, r, c) ? !baseMatrix[r][c] : baseMatrix[r][c];
      })
    );

    // Write format info for penalty testing
    const formatBits = getFormatInfo(ecLevel, mask);
    const writeFormat = (mat: boolean[][]) => {
      // Around top-left
      const bits: boolean[] = [];
      for (let i = 0; i < 15; i++) bits.push(((formatBits >>> i) & 1) === 1);

      mat[8][0] = bits[0];
      mat[8][1] = bits[1];
      mat[8][2] = bits[2];
      mat[8][3] = bits[3];
      mat[8][4] = bits[4];
      mat[8][5] = bits[5];
      mat[8][7] = bits[6];
      mat[8][8] = bits[7];
      mat[7][8] = bits[8];
      mat[5][8] = bits[9];
      mat[4][8] = bits[10];
      mat[3][8] = bits[11];
      mat[2][8] = bits[12];
      mat[1][8] = bits[13];
      mat[0][8] = bits[14];

      // Second copy
      for (let i = 0; i < 7; i++) {
        mat[size - 1 - i][8] = bits[i];
      }
      for (let i = 0; i < 8; i++) {
        mat[8][size - 8 + i] = bits[7 + i];
      }
    };

    writeFormat(candidate);
    const penalty = calculatePenalty(candidate, size);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  return bestMatrix;
}

/**
 * Generates an SVG string containing the QR Code vector image.
 * Uses a single crisp path element for ultra-lightweight and sharp rendering.
 * @param text The text or URL to encode.
 * @param size The rendered SVG dimension in pixels (default 256).
 */
export function generateQrCodeSvg(text: string, size = 256): string {
  const matrix = generateQrMatrix(text);
  const matrixSize = matrix.length;
  const margin = 4;
  const viewBoxSize = matrixSize + margin * 2;

  let pathData = '';
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        const x = c + margin;
        const y = r + margin;
        pathData += `M${x},${y}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <path d="${pathData.trim()}" fill="#000000"/>
</svg>`;
}
