/** Sleep for a random duration in [minMs, maxMs), so timing doesn't look scripted. */
export function jitterDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry an async operation with exponential backoff plus jitter between attempts. */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries: number; baseDelayMs: number; label: string }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      console.warn(
        `[${opts.label}] attempt ${attempt}/${opts.retries} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      if (attempt < opts.retries) {
        const backoff = opts.baseDelayMs * attempt;
        await jitterDelay(backoff, backoff * 1.75);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`[${opts.label}] failed after ${opts.retries} attempts`);
}
