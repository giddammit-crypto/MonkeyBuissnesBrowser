// Includes JSON framing and reasoning, with ample room for a 4K-token completion.
export const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function readProviderText(response: Response, limit = MAX_PROVIDER_RESPONSE_BYTES): Promise<string> {
  const tooLarge = () => new Error('Ответ AI-провайдера превышает допустимый размер');
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) {
    // Empty native Responses and response adapters used by transport tests.
    const text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(text, 'utf8') > limit) throw tooLarge();
    return text;
  }
  let size = 0;
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function readProviderJson(response: Response): Promise<Record<string, any>> {
  return JSON.parse(await readProviderText(response));
}
