interface RetryOptions {
  retries?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  delayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_DELAY_MS = 0;
const DEFAULT_BACKOFF_MULTIPLIER = 1;

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const initialDelayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const backoffMultiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt <= retries && (options.shouldRetry?.(error, attempt) ?? true);

      if (!shouldRetry) {
        throw error;
      }

      if (initialDelayMs > 0) {
        const delayMs = Math.round(initialDelayMs * Math.max(1, backoffMultiplier ** (attempt - 1)));
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
