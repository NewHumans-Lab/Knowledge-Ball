export const DEFAULT_FETCH_DEADLINE_MS = 8_000;

export class FetchDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Network request exceeded ${timeoutMs}ms`);
    this.name = 'FetchDeadlineError';
  }
}

/**
 * Wrap fetch with a hard client-side deadline. Real fetch observes the abort
 * signal; Promise rejection also guarantees callers are released even when a
 * test/custom transport ignores AbortSignal.
 */
export function withFetchDeadline(
  request: typeof fetch,
  timeoutMs = DEFAULT_FETCH_DEADLINE_MS,
): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('fetch deadline must be positive');

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const forwardAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) forwardAbort();
    else upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });

    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        const error = new FetchDeadlineError(timeoutMs);
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        request(input, { ...init, signal: controller.signal }),
        deadline,
      ]);
    } finally {
      if (timer !== null) globalThis.clearTimeout(timer);
      upstreamSignal?.removeEventListener('abort', forwardAbort);
    }
  }) as typeof fetch;
}
