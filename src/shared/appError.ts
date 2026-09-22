/**
 * The error contract shared by the resolver and both UI modules.
 *
 * Why this exists: Forge's `invoke` does not guarantee that a thrown `Error`'s message, name or
 * custom fields survive the trip from the resolver to the UI. Before this, the frontend decided
 * how to react to a conflict by pattern-matching English prose in an error message - which is
 * both fragile and untranslatable.
 *
 * Instead every resolver definition now returns a plain, serialisable envelope:
 *
 *   success:  { ok: true,  data: <payload> }
 *   failure:  { ok: false, code: 'CONFLICT', message: 'human readable text' }
 *
 * Plain objects always survive `invoke`, so the UI can branch on the stable `code` and use
 * `message` purely for display.
 *
 * This module is imported by BOTH the backend and the frontend bundles, so it must stay free of
 * any platform-specific imports (no `@forge/api`, no `@forge/bridge`, no Node built-ins).
 */

/**
 * Stable, machine-readable failure reasons.
 *
 * - `VALIDATION`         - the payload was malformed; retrying unchanged will not help.
 * - `NOT_FOUND`          - the target does not exist, or the caller may not see it. The two are
 *                          deliberately indistinguishable so we never leak existence.
 * - `CONFLICT`           - someone else changed the record first; the UI should refresh.
 * - `INVALID_TRANSITION` - the requested workflow move is not legal from the current status.
 * - `UNKNOWN`            - anything unanticipated.
 */
export const APP_ERROR_CODES = ['VALIDATION', 'NOT_FOUND', 'CONFLICT', 'INVALID_TRANSITION', 'UNKNOWN'] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppErrorEnvelope {
  ok: false;
  code: AppErrorCode;
  message: string;
}

export interface AppSuccessEnvelope<TData> {
  ok: true;
  data: TData;
}

export type AppEnvelope<TData> = AppSuccessEnvelope<TData> | AppErrorEnvelope;

/**
 * Errors thrown inside services carry a code so the resolver can translate them into an
 * envelope without inspecting message text.
 */
export class AppError extends Error {
  public readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/** Convenience constructors, used heavily enough to be worth the shorthand. */
export const validationError = (message: string): AppError => new AppError('VALIDATION', message);
export const notFoundError = (message: string): AppError => new AppError('NOT_FOUND', message);
export const conflictError = (message: string): AppError => new AppError('CONFLICT', message);
export const invalidTransitionError = (message: string): AppError => new AppError('INVALID_TRANSITION', message);

const isAppErrorCode = (value: unknown): value is AppErrorCode => {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
};

/**
 * Narrows an unknown value (typically an `invoke` result) to the failure envelope. Used on the
 * frontend, where the response arrives as `unknown` after crossing the bridge.
 */
export const isAppErrorEnvelope = (value: unknown): value is AppErrorEnvelope => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.ok === false && isAppErrorCode(candidate.code);
};

/**
 * Converts any thrown value into a failure envelope.
 *
 * Only `AppError`s get a specific code. Everything else collapses to `UNKNOWN` with a generic
 * message on purpose: an unexpected exception may carry SQL fragments, ids or stack details we
 * do not want to hand to the browser. The real error is logged server-side instead.
 */
export const toAppErrorEnvelope = (error: unknown): AppErrorEnvelope => {
  if (error instanceof AppError) {
    return { ok: false, code: error.code, message: error.message };
  }

  return {
    ok: false,
    code: 'UNKNOWN',
    message: 'Something went wrong. Please try again.'
  };
};
