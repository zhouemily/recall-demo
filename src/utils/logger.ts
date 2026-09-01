/**
 * Lightweight structured logger.
 *
 * Wraps console methods with a consistent format:
 *   [ISO timestamp] [LEVEL] message  { ...context }
 *
 * Extend this module to swap in a production logger (e.g. Winston, Pino)
 * without touching any call sites — every service imports from here, not
 * directly from console.
 */

type LogContext = Record<string, unknown>;

function formatMessage(level: string, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level}] ${message}${contextStr}`;
}

export const logger = {
  /**
   * Informational messages for normal application flow.
   * @param message - Human-readable description of the event.
   * @param context - Optional key-value pairs for structured context.
   */
  info(message: string, context?: LogContext): void {
    console.log(formatMessage("INFO", message, context));
  },

  /**
   * Non-fatal issues that warrant attention but don't stop execution.
   * @param message - Description of the warning condition.
   * @param context - Optional key-value pairs for structured context.
   */
  warn(message: string, context?: LogContext): void {
    console.warn(formatMessage("WARN", message, context));
  },

  /**
   * Errors that indicate a failed operation. Always include relevant
   * identifiers (bot_id, request path, etc.) in the context object.
   * @param message - Description of what failed.
   * @param context - Optional key-value pairs for structured context.
   */
  error(message: string, context?: LogContext): void {
    console.error(formatMessage("ERROR", message, context));
  },

  /**
   * Verbose output for development. Strip or disable in production.
   * @param message - Debug message.
   * @param context - Optional key-value pairs for structured context.
   */
  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production") {
      console.debug(formatMessage("DEBUG", message, context));
    }
  },
};
