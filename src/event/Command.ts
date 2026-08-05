const TIME_BUCKET_MS = 5000;

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  const body = keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(',');
  return `{${body}}`;
}

export async function fingerprint(type: string, payload: unknown, now = Date.now()): Promise<string> {
  const bucket = Math.floor(now / TIME_BUCKET_MS);
  const canonical = stableStringify({ type, payload, bucket });
  return sha256Hex(canonical);
}

export interface CommandResult<E> {
  ok: boolean;
  event?: E;
  error?: string;
}
