// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIssueContextData } from './useIssueContextData';
import {
  getIssueKeyFromContext,
  getIssuePanelData,
  linkContentToTicket,
  searchConfluenceContent,
  unlinkContentFromTicket,
  type SearchContentPage
} from '../services/issueContextService';
import { ResolverError } from '../../../shared/resolverClient';
import type { IssuePanelData, LinkedPage, SearchContentResult } from '../types';

/**
 * `@forge/bridge` throws on import outside a real Forge iframe, so it is stubbed before
 * anything can pull it in.
 */
vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { getContext: vi.fn() }
}));

/**
 * Tests for the issue panel's orchestration logic: loading, optimistic link/unlink, error
 * surfacing, and the debounced search. The service layer is mocked; the pure formatters keep
 * their real behaviour.
 */
vi.mock('../services/issueContextService', async () => {
  const actual = await vi.importActual<typeof import('../services/issueContextService')>(
    '../services/issueContextService'
  );

  return {
    ...actual,
    getIssueKeyFromContext: vi.fn(),
    getIssuePanelData: vi.fn(),
    linkContentToTicket: vi.fn(),
    searchConfluenceContent: vi.fn(),
    unlinkContentFromTicket: vi.fn()
  };
});

const buildLinkedPage = (overrides: Partial<LinkedPage> = {}): LinkedPage => ({
  id: 'link-1',
  contentId: '42',
  issueKey: 'ABC-1',
  title: 'Release notes',
  spaceKey: 'DOC',
  spaceName: 'Docs',
  contentType: 'page',
  status: 'not_started',
  webUrl: '/wiki/42',
  linkedAt: 1,
  updatedAt: null,
  ...overrides
});

const buildData = (overrides: Partial<IssuePanelData> = {}): IssuePanelData => ({
  linkedPages: [buildLinkedPage()],
  truncated: false,
  ...overrides
});

const buildResult = (overrides: Partial<SearchContentResult> = {}): SearchContentResult => ({
  id: '99',
  title: 'Architecture',
  spaceKey: 'ENG',
  spaceName: 'Engineering',
  contentType: 'page',
  webUrl: '/wiki/99',
  excerpt: '',
  excerptMatches: [],
  breadcrumb: 'Engineering',
  lastModified: '3 days ago',
  ...overrides
});

const buildPage = (overrides: Partial<SearchContentPage> = {}): SearchContentPage => ({
  results: [buildResult()],
  nextCursor: null,
  resolvedFromLink: false,
  ...overrides
});

describe('useIssueContextData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(getIssueKeyFromContext).mockResolvedValue('ABC-1');
    vi.mocked(getIssuePanelData).mockResolvedValue(buildData());
    vi.mocked(searchConfluenceContent).mockResolvedValue(buildPage());
  });

  it('loads the linked resources in a single service call', async () => {
    const { result } = renderHook(() => useIssueContextData());

    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    expect(vi.mocked(getIssuePanelData)).toHaveBeenCalledTimes(1);
    expect(result.current.linkedPages).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('reports a missing issue context instead of spinning forever', async () => {
    vi.mocked(getIssueKeyFromContext).mockResolvedValue(null);

    const { result } = renderHook(() => useIssueContextData());

    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));
    expect(result.current.error).toContain('Could not determine the current issue');
    expect(vi.mocked(getIssuePanelData)).not.toHaveBeenCalled();
  });

  it('surfaces a load failure rather than showing an empty table', async () => {
    vi.mocked(getIssuePanelData).mockRejectedValue(new ResolverError('UNKNOWN', 'Something went wrong.'));

    const { result } = renderHook(() => useIssueContextData());

    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));
    expect(result.current.error).toContain('Could not load linked resources');
    expect(result.current.linkedPages).toEqual([]);
  });

  it('warns when the link list was truncated', async () => {
    vi.mocked(getIssuePanelData).mockResolvedValue(buildData({ truncated: true }));

    const { result } = renderHook(() => useIssueContextData());

    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));
    expect(result.current.warning).toContain('more links than can be displayed');
  });

  it('does not search at all while the picker is closed', async () => {
    const { result } = renderHook(() => useIssueContextData());

    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Merely opening an issue must not cost a Confluence request.
    expect(vi.mocked(searchConfluenceContent)).not.toHaveBeenCalled();
    expect(result.current.isPickerOpen).toBe(false);
  });

  it('shows recently edited content as soon as the picker opens', async () => {
    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    act(() => {
      result.current.onOpenPicker();
    });

    // The picker is useful before any typing: an empty query is answered with recent content
    // rather than an empty list.
    await waitFor(() => expect(result.current.searchState.results).toHaveLength(1));
    expect(vi.mocked(searchConfluenceContent)).toHaveBeenCalledWith('', ['page', 'blogpost']);
    expect(result.current.searchState.isRecent).toBe(true);
  });

  it('resets the search when the picker closes', async () => {
    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    act(() => {
      result.current.onOpenPicker();
    });
    await waitFor(() => expect(result.current.searchState.results).toHaveLength(1));

    act(() => {
      result.current.onQueryChange('arch');
    });
    act(() => {
      result.current.onClosePicker();
    });

    // Reopening on a stale query and stale results would misrepresent what is already linked.
    expect(result.current.query).toBe('');
    expect(result.current.searchState.results).toEqual([]);
    expect(result.current.isPickerOpen).toBe(false);
  });

  it('adds the new resource optimistically after a successful link', async () => {
    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    await act(async () => {
      await result.current.onSelectResult(buildResult());
    });

    // The content type is deliberately not passed - the resolver reads it from Confluence.
    expect(vi.mocked(linkContentToTicket)).toHaveBeenCalledWith('99', 'ABC-1');
    expect(result.current.linkedPages.map((page) => page.contentId)).toEqual(['42', '99']);
  });

  it('does not duplicate a resource that is already linked', async () => {
    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    await act(async () => {
      await result.current.onSelectResult(buildResult({ id: '42' }));
    });

    expect(result.current.linkedPages).toHaveLength(1);
  });

  it('exposes the linked content ids so the picker can mark those rows', async () => {
    const { result } = renderHook(() => useIssueContextData());

    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));
    expect(result.current.linkedContentIds).toEqual(['42']);
  });

  it('surfaces a link failure instead of failing silently', async () => {
    vi.mocked(linkContentToTicket).mockRejectedValue(new ResolverError('NOT_FOUND', 'Issue not found'));

    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    await act(async () => {
      await result.current.onSelectResult(buildResult());
    });

    expect(result.current.error).toContain('Could not link that resource');
    expect(result.current.linkedPages).toHaveLength(1);
  });

  it('removes the row after a successful unlink', async () => {
    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    await act(async () => {
      await result.current.onRemovePage('link-1', '42', 'ABC-1');
    });

    expect(result.current.linkedPages).toEqual([]);
  });

  it('keeps the row and surfaces the error when unlinking fails', async () => {
    vi.mocked(unlinkContentFromTicket).mockRejectedValue(new ResolverError('UNKNOWN', 'nope'));

    const { result } = renderHook(() => useIssueContextData());
    await waitFor(() => expect(result.current.isLoadingLinks).toBe(false));

    await act(async () => {
      await result.current.onRemovePage('link-1', '42', 'ABC-1');
    });

    expect(result.current.error).toContain('Could not unlink that resource');
    expect(result.current.linkedPages).toHaveLength(1);
  });

  it('debounces the search so a burst of keystrokes issues one request', async () => {
    const { result } = renderHook(() => useIssueContextData());
    act(() => {
      result.current.onOpenPicker();
    });
    await waitFor(() => expect(result.current.searchState.results).toHaveLength(1));
    vi.mocked(searchConfluenceContent).mockClear();

    act(() => {
      result.current.onQueryChange('a');
      result.current.onQueryChange('ar');
      result.current.onQueryChange('arch');
    });

    await waitFor(() => expect(vi.mocked(searchConfluenceContent)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(searchConfluenceContent)).toHaveBeenCalledWith('arch', ['page', 'blogpost']);
  });

  it('always searches every content type, since the UI has no type filter', async () => {
    const { result } = renderHook(() => useIssueContextData());
    act(() => {
      result.current.onOpenPicker();
    });
    await waitFor(() => expect(result.current.searchState.results).toHaveLength(1));
    vi.mocked(searchConfluenceContent).mockClear();

    act(() => {
      result.current.onQueryChange('arch');
    });

    // There is no type filter in the UI - the per-row icon carries the type instead - so every
    // search must ask for the full set rather than whatever a previous interaction left behind.
    await waitFor(() => expect(vi.mocked(searchConfluenceContent)).toHaveBeenCalledWith('arch', ['page', 'blogpost']));
  });

  it('appends the next page of results instead of replacing them', async () => {
    vi.mocked(searchConfluenceContent).mockResolvedValueOnce(buildPage({ nextCursor: 'cursor-2' }));

    const { result } = renderHook(() => useIssueContextData());
    act(() => {
      result.current.onOpenPicker();
    });
    await waitFor(() => expect(result.current.searchState.nextCursor).toBe('cursor-2'));

    vi.mocked(searchConfluenceContent).mockResolvedValueOnce(
      buildPage({ results: [buildResult({ id: '100', title: 'Runbook' })] })
    );

    await act(async () => {
      await result.current.onLoadMore();
    });

    expect(result.current.searchState.results.map((entry) => entry.id)).toEqual(['99', '100']);
    expect(result.current.searchState.nextCursor).toBeNull();
  });

  it('reports a search failure in the search state, not the main error banner', async () => {
    vi.mocked(searchConfluenceContent).mockRejectedValue(new Error('search down'));

    const { result } = renderHook(() => useIssueContextData());
    act(() => {
      result.current.onOpenPicker();
    });

    await waitFor(() => expect(result.current.searchState.error).toContain('could not search Confluence'));
    expect(result.current.error).toBeNull();
  });
});
