import { describe, expect, it } from 'vitest';
import { generateQrMatrix, generateQrCodeSvg } from '../../src/shared/qrCode';

describe('QR Code generator (ISO/IEC 18004)', () => {
  it('generates valid QR matrix for short URLs and text', () => {
    const matrix = generateQrMatrix('https://example.com');
    expect(matrix).toBeDefined();
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0].length).toBe(matrix.length);
    // Finder pattern checks: top-left 7x7 corner
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][1]).toBe(true);
    expect(matrix[0][2]).toBe(true);
    expect(matrix[1][1]).toBe(false);
    expect(matrix[2][2]).toBe(true);
  });

  it('generates clean, standalone SVG image', () => {
    const svg = generateQrCodeSvg('https://soulm8te.invalid', 300);
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<path');
    expect(svg).toContain('fill="#000000"');
  });

  it('handles longer URLs by automatically stepping up QR versions', () => {
    const longUrl = 'https://example.com/very/long/path/with/lots/of/parameters?foo=bar&baz=qux&session=abcdef1234567890&token=xyz987654321';
    const matrix = generateQrMatrix(longUrl);
    expect(matrix.length).toBeGreaterThan(21);
    const svg = generateQrCodeSvg(longUrl);
    expect(svg).toContain('<svg');
  });
});
