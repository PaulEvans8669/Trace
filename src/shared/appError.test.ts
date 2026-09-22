import { describe, expect, it } from 'vitest';
import {
  AppError,
  conflictError,
  isAppErrorEnvelope,
  toAppErrorEnvelope,
  validationError
} from './appError';

/**
 * These tests pin down the contract that both bundles depend on. The most important property
 * is the last one: an unexpected exception must never leak its message to the browser.
 */
describe('appError', () => {
  it('preserves the code and message of a known failure', () => {
    expect(toAppErrorEnvelope(conflictError('Someone else got there first'))).toEqual({
      ok: false,
      code: 'CONFLICT',
      message: 'Someone else got there first'
    });
  });

  it('keeps AppError usable as an ordinary Error', () => {
    const error = validationError('contentId is required');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('contentId is required');
    expect(error.code).toBe('VALIDATION');
  });

  it('collapses an unexpected exception to a generic UNKNOWN envelope', () => {
    // An unhandled error may carry SQL fragments or internal ids, so its message must not
    // cross the bridge. The real error is logged server-side instead.
    const envelope = toAppErrorEnvelope(new Error('ER_PARSE_ERROR near content_ticket_links'));

    expect(envelope.code).toBe('UNKNOWN');
    expect(envelope.message).not.toContain('content_ticket_links');
  });

  it('handles non-Error throwables', () => {
    expect(toAppErrorEnvelope('a bare string').code).toBe('UNKNOWN');
    expect(toAppErrorEnvelope(null).code).toBe('UNKNOWN');
  });

  it('recognises a failure envelope that crossed the bridge', () => {
    expect(isAppErrorEnvelope({ ok: false, code: 'NOT_FOUND', message: 'gone' })).toBe(true);
  });

  it('rejects anything that is not a failure envelope', () => {
    expect(isAppErrorEnvelope({ ok: true, data: {} })).toBe(false);
    expect(isAppErrorEnvelope({ ok: false, code: 'MADE_UP', message: 'x' })).toBe(false);
    expect(isAppErrorEnvelope(null)).toBe(false);
    expect(isAppErrorEnvelope('error')).toBe(false);
  });

  it('round-trips a thrown AppError through the envelope and back', () => {
    const envelope = toAppErrorEnvelope(new AppError('INVALID_TRANSITION', 'not an edge'));

    expect(isAppErrorEnvelope(envelope)).toBe(true);
    expect(envelope.code).toBe('INVALID_TRANSITION');
  });
});
