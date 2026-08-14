export function safeAvatarUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
