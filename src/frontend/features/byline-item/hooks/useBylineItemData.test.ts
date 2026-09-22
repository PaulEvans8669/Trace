// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBylineItemData } from './useBylineItemData';
import {
  getBylineContext,
  getBylineData,
  getLinkTransitionHistory,
  updateLinkStatus
} from '../services/bylineItemService';
import { ResolverError } from '../../../shared/resolverClient';
import type { BylineData, ContentLink } from '../types';

/**
 * `@forge/bridge` throws on import outside a real Forge iframe, so it is stubbed before
 * anything can pull it in. The hook never touches it directly - only through the mocked
 * service - but `importActual` below loads the module graph.
 */
vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { getContext: vi.fn() }
}));

/**
 * Tests for the byline panel's orchestration logic.
 *
 * The service layer is mocked out entirely: these tests are about what the hook *does* with
 * responses (optimistic updates, error surfacing, refreshing after a conflict), not about how
 * the bridge is called. `emptyPageContext` and the message formatters keep their real
 * behaviour, since they are pure.
 */
vi.mock('../services/bylineItemService', async () => {
  const actual = await vi.importActual<typeof import('../services/bylineItemService')>(
    '../services/bylineItemService'
  );

  return {
    ...actual,
    getBylineContext: vi.fn(),
    getBylineData: vi.fn(),
    getLinkTransitionHistory: vi.fn(),
    updateLinkStatus: vi.fn()
  };
});

const buildLink = (overrides: Partial<ContentLink> = {}): ContentLink => ({
  id: 'link-1',
  contentId: '42',
  issueKey: 'ABC-1',
  issueTypeName: 'Task',
  issueTypeIconUrl: '',
  status: 'not_started',
  summary: 'Write the docs',
  linkedAt: 1,
  updatedAt: 1,
  transitionVersion: null,
  ...overrides
});

const buildData = (overrides: Partial<BylineData> = {}): BylineData => ({
  links: [buildLink()],
  truncated: false,
  pageTitle: 'Release notes',
  pageSpaceKey: 'DOC',
  ...overrides
});

describe('useBylineItemData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBylineContext).mockResolvedValue({ contentId: '42', siteUrl: 'https://example.atlassian.net' });
    vi.mocked(getBylineData).mockResolvedValue(buildData());
    vi.mocked(getLinkTransitionHistory).mockResolvedValue([]);
  });

  it('loads the panel in a single service call', async () => {
    const { result } = renderHook(() => useBylineItemData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(vi.mocked(getBylineData)).toHaveBeenCalledTimes(1);
    expect(result.current.links).toHaveLength(1);
    expect(result.current.pageContext.pageTitle).toBe('Release notes');
    expect(result.current.error).toBeNull();
  });

  it('reports a missing content id instead of hanging on the spinner', async () => {
    vi.mocked(getBylineContext).mockResolvedValue({ contentId: null, siteUrl: '' });

    const { result } = renderHook(() => useBylineItemData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toContain('Could not determine content ID');
  });

  it('surfaces a load failure rather than showing an empty table', async () => {
    vi.mocked(getBylineData).mockRejectedValue(new ResolverError('NOT_FOUND', 'Content not found or not accessible'));

    const { result } = renderHook(() => useBylineItemData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toContain('Content not found or not accessible');
    expect(result.current.links).toEqual([]);
  });

  it('warns when the link list was truncated', async () => {
    vi.mocked(getBylineData).mockResolvedValue(buildData({ truncated: true }));

    const { result } = renderHook(() => useBylineItemData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.warning).toContain('more links than can be displayed');
  });

  it('applies a successful transition to the row without refetching', async () => {
    vi.mocked(updateLinkStatus).mockResolvedValue({ transitionVersion: 7, updatedAt: 500 });

    const { result } = renderHook(() => useBylineItemData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.onUpdateStatus('ABC-1', '42', 'ongoing_work');
    });

    expect(result.current.links[0]?.status).toBe('ongoing_work');
    expect(result.current.links[0]?.transitionVersion).toBe(7);
    expect(result.current.error).toBeNull();
    // Only the initial load; a successful transition needs no second round trip.
    expect(vi.mocked(getBylineData)).toHaveBeenCalledTimes(1);
  });

  it('reloads the panel when the resolver reports a CONFLICT', async () => {
    // This is the payoff of the typed error envelope: the hook branches on the machine-readable
    // code, so a stale panel resynchronises instead of just showing an error.
    vi.mocked(updateLinkStatus).mockRejectedValue(new ResolverError('CONFLICT', 'This link was updated by someone else.'));
    vi.mocked(getBylineData).mockResolvedValueOnce(buildData()).mockResolvedValueOnce(
      buildData({ links: [buildLink({ status: 'done' })] })
    );

    const { result } = renderHook(() => useBylineItemData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.onUpdateStatus('ABC-1', '42', 'ongoing_work');
    });

    expect(vi.mocked(getBylineData)).toHaveBeenCalledTimes(2);
    expect(result.current.links[0]?.status).toBe('done');
    expect(result.current.error).toContain('updated by someone else');
  });

  it('does not reload for a non-conflict transition failure', async () => {
    vi.mocked(updateLinkStatus).mockRejectedValue(
      new ResolverError('INVALID_TRANSITION', 'Invalid transition from not_started to done')
    );

    const { result } = renderHook(() => useBylineItemData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.onUpdateStatus('ABC-1', '42', 'done');
    });

    expect(vi.mocked(getBylineData)).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain('Invalid transition');
    // The row keeps its real status - no optimistic change is left behind.
    expect(result.current.links[0]?.status).toBe('not_started');
  });

  it('loads history when a link is opened and clears it on the way back', async () => {
    vi.mocked(getLinkTransitionHistory).mockResolvedValue([
      {
        id: 'h-1',
        contentId: '42',
        issueKey: 'ABC-1',
        status: 'not_started',
        transitionVersion: 1,
        transitionedAt: 10,
        transitionedByAccountId: null
      }
    ]);

    const { result } = renderHook(() => useBylineItemData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.openDetailsForLink('link-1');
    });

    await waitFor(() => expect(result.current.historyItems).toHaveLength(1));

    act(() => {
      result.current.goBackToTable();
    });

    expect(result.current.historyItems).toEqual([]);
    expect(result.current.selectedDetailsLinkId).toBeNull();
  });

  it('surfaces a history load failure separately from the main error', async () => {
    vi.mocked(getLinkTransitionHistory).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useBylineItemData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.openDetailsForLink('link-1');
    });

    await waitFor(() => expect(result.current.historyError).toBe('Could not load transition history'));
    expect(result.current.error).toBeNull();
  });
});
