interface RetryOptions {
  retries?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRIES = 2;

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
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
    }
  }

  throw lastError;
}
