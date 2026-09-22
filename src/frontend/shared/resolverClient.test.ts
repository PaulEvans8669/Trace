// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@forge/bridge';
import { callResolver, errorCodeOf, isConflictError, ResolverError } from './resolverClient';

vi.mock('@forge/bridge', () => ({
  invoke: vi.fn()
}));

/**
 * The frontend half of the error contract: unwrapping success, and turning failure envelopes
 * back into throwables that still carry a machine-readable code.
 */
describe('resolverClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps the data from a success envelope', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, data: { links: [1, 2] } });

    await expect(callResolver('getBylineView', { contentId: '42' })).resolves.toEqual({ links: [1, 2] });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('getBylineView', { contentId: '42' });
  });

  it('throws a ResolverError carrying the code from a failure envelope', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: false, code: 'CONFLICT', message: 'Someone else changed it' });

    const error = await callResolver('updateLinkStatus').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResolverError);
    expect((error as ResolverError).code).toBe('CONFLICT');
    expect((error as ResolverError).message).toBe('Someone else changed it');
  });

  it('falls back to UNKNOWN when the bridge returns something unrecognisable', async () => {
    // Covers a function crash or a platform-level failure, where no envelope comes back at all.
    vi.mocked(invoke).mockResolvedValue('unexpected');

    const error = await callResolver('getBylineView').catch((caught: unknown) => caught);

    expect((error as ResolverError).code).toBe('UNKNOWN');
  });

  it('identifies conflicts without inspecting message text', () => {
    expect(isConflictError(new ResolverError('CONFLICT', 'anything at all'))).toBe(true);
    expect(isConflictError(new ResolverError('NOT_FOUND', 'This link was updated by someone else'))).toBe(false);
    expect(isConflictError(new Error('conflict'))).toBe(false);
  });

  it('returns null for errors that did not come from the resolver', () => {
    expect(errorCodeOf(new Error('network down'))).toBeNull();
  });
});
