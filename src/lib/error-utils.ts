/**
 * extractApiErrorMessage
 *
 * Extracts the first human-readable field error message from structured API error
 * responses returned by server-side validation (file size, screenshot count,
 * mimetype, phase validation, link validation, Zod flatten).
 *
 * Error shape expected:
 *   { error: string, details: { fieldErrors: { fieldName: string[] } } }
 */

export function extractApiErrorMessage(err: Record<string, unknown>): string {
  // Check for fieldErrors on details object
  const details = err.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const fieldErrors = (details as Record<string, unknown>).fieldErrors;
    if (fieldErrors && typeof fieldErrors === 'object' && !Array.isArray(fieldErrors)) {
      const entries = Object.entries(fieldErrors as Record<string, unknown>);
      if (entries.length > 0) {
        const [, messages] = entries[0];
        if (Array.isArray(messages) && messages.length > 0 && typeof messages[0] === 'string') {
          return messages[0];
        }
      }
    }
  }

  // Fall back to err.error as a string
  if (typeof err.error === 'string' && err.error.length > 0) {
    return err.error;
  }

  // Generic fallback
  return 'An unexpected error occurred.';
}
