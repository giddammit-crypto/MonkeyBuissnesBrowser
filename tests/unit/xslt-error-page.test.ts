import { describe, expect, it } from 'vitest';
import { buildXsltErrorDocument } from '../../src/main/services/XsltPageProbe';

describe('XSLT error document', () => {
  it('explains the reason and keeps the original XML readable', () => {
    const page = buildXsltErrorDocument('Функция document() отключена политикой безопасности', '<secret a="1"/>');
    expect(page).toContain('Не удалось преобразовать XML через XSLT');
    expect(page).toContain('document()');
    expect(page).toContain('&lt;secret a=&quot;1&quot;/&gt;');
    expect(page).not.toContain('<secret a="1"/>');
  });

  it('escapes hostile markup instead of injecting it', () => {
    const page = buildXsltErrorDocument('<img src=x onerror="alert(1)">', '<script>alert(2)</script>');
    expect(page).not.toContain('<script>alert(2)</script>');
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;script&gt;');
    expect(page).toContain('&lt;img src=x');
  });

  it('bounds both the message and the source it echoes', () => {
    const page = buildXsltErrorDocument('x'.repeat(5000), 'y'.repeat(400_000));
    expect(page.length).toBeLessThan(260_000);
    expect(page).toContain('x'.repeat(600));
  });
});
