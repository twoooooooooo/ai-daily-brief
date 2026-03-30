type LogLevel = "info" | "warn" | "error";

export interface LogMetadata {
  [key: string]: unknown;
}

export interface LogContext extends LogMetadata {
  correlationId?: string;
  invocationId?: string;
  operationName?: string;
  component?: string;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

function serializeError(error: unknown): SerializedError | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const serializedCause = serializeError(cause);
  if (serializedCause) {
    serialized.cause = serializedCause;
  }

  return serialized;
}

export function createCorrelationId(prefix = "op"): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function formatLog(scope: string, level: LogLevel, message: string, metadata?: LogMetadata): string {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(metadata ? { metadata } : {}),
  };

  return JSON.stringify(payload);
}

export function createLogger(scope: string, baseContext: LogContext = {}) {
  function mergeMetadata(metadata?: LogMetadata): LogMetadata | undefined {
    if (!metadata && Object.keys(baseContext).length === 0) {
      return undefined;
    }

    return {
      ...baseContext,
      ...metadata,
    };
  }

  return {
    info(message: string, metadata?: LogMetadata): void {
      console.info(formatLog(scope, "info", message, mergeMetadata(metadata)));
    },
    warn(message: string, metadata?: LogMetadata): void {
      console.warn(formatLog(scope, "warn", message, mergeMetadata(metadata)));
    },
    error(message: string, metadata?: LogMetadata): void {
      console.error(formatLog(scope, "error", message, mergeMetadata(metadata)));
    },
    exception(message: string, error: unknown, metadata?: LogMetadata): void {
      console.error(formatLog(scope, "error", message, mergeMetadata({
        ...metadata,
        error: serializeError(error),
      })));
    },
    child(context: LogContext) {
      return createLogger(scope, {
        ...baseContext,
        ...context,
      });
    },
  };
}
