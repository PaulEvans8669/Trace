import { invoke } from '@forge/bridge';
import { isAppErrorEnvelope, type AppErrorCode } from '../../shared/appError';

/**
 * The single place where the frontend talks to the resolver.
 *
 * Every resolver definition returns an envelope - `{ ok: true, data }` or
 * `{ ok: false, code, message }` - because a thrown Error's message and custom fields are not
 * guaranteed to survive Forge's `invoke` bridge, whereas plain objects always are.
 *
 * `callResolver` turns the failure envelope back into a throwable so callers can keep using
 * ordinary try/catch, but the thrown value carries a stable `code` the UI can branch on instead
 * of pattern-matching English error text.
 */

/** An error that crossed the bridge with its machine-readable reason intact. */
export class ResolverError extends Error {
  public readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'ResolverError';
    this.code = code;
  }
}

/** Narrowing helper so views can ask "was this a conflict?" without instanceof gymnastics. */
export const errorCodeOf = (error: unknown): AppErrorCode | null => {
  return error instanceof ResolverError ? error.code : null;
};

export const isConflictError = (error: unknown): boolean => errorCodeOf(error) === 'CONFLICT';

interface SuccessEnvelope<TData> {
  ok: true;
  data: TData;
}

const isSuccessEnvelope = <TData>(value: unknown): value is SuccessEnvelope<TData> => {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).ok === true;
};

/**
 * Invokes a resolver function and returns its data, throwing a `ResolverError` on failure.
 *
 * The final `else` covers the case where the bridge itself fails (network, timeout, function
 * crash) and returns something that is not an envelope at all.
 */
export const callResolver = async <TData>(functionKey: string, payload?: unknown): Promise<TData> => {
  const response = await invoke(functionKey, payload as Record<string, unknown> | undefined);

  if (isSuccessEnvelope<TData>(response)) {
    return response.data;
  }

  if (isAppErrorEnvelope(response)) {
    throw new ResolverError(response.code, response.message);
  }

  throw new ResolverError('UNKNOWN', 'The server returned an unexpected response.');
};
