import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentType } from '../../../shared/contentType';
import { CONTENT_TYPES } from '../../../shared/contentType';
import type { LinkedPage, SearchContentResult, SearchState, IssueContextViewModel } from '../types';
import {
  getIssueKeyFromContext,
  getIssuePanelData,
  linkContentToTicket,
  searchConfluenceContent,
  toLinkError,
  toLinkedPageFromSearch,
  toLoadError,
  toSearchError,
  toUnlinkError,
  truncationWarning,
  unlinkContentFromTicket
} from '../services/issueContextService';

/**
 * State for the Jira issue context panel: the linked resources table plus the Confluence picker.
 */

const initialSearchState: SearchState = {
  loading: false,
  loadingMore: false,
  error: '',
  results: [],
  nextCursor: null,
  hasSearched: false,
  resolvedFromLink: false,
  isRecent: false
};

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * A single character is enough to search.
 *
 * The CQL uses a `title ~ "q*"` prefix match, so one letter already narrows meaningfully, and
 * the debounce keeps the request rate sane. The old two-character floor existed only because
 * the query was an exact title match that was useless until nearly complete.
 */
const MIN_SEARCH_QUERY_LENGTH = 1;

export const useIssueContextData = (): IssueContextViewModel => {
  const [query, setQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>(initialSearchState);
  const [linkedPages, setLinkedPages] = useState<LinkedPage[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [pendingContentId, setPendingContentId] = useState<string | null>(null);
  const [contextIssueKey, setContextIssueKey] = useState<string | null>(null);
  const [isLoadingLinks, setIsLoadingLinks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  /**
   * Identifies the search whose response is allowed to land.
   *
   * The debounce effect already guards itself with a local `isActive` flag, but "Load more" runs
   * outside that effect and must also be discarded if the query changed while it was in flight.
   * A shared counter lets both paths answer the same question: "is this still the current search?"
   */
  const searchGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const loadContext = async () => {
      try {
        const issueKey = await getIssueKeyFromContext();
        if (!cancelled) {
          setContextIssueKey(issueKey);
          if (!issueKey) {
            setError('Could not determine the current issue');
            setIsLoadingLinks(false);
          }
        }
      } catch (contextError) {
        console.error('Could not get context:', contextError);
        if (!cancelled) {
          setError(toLoadError(contextError));
          setIsLoadingLinks(false);
        }
      }
    };

    void loadContext();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!contextIssueKey) {
      return;
    }

    let cancelled = false;

    const loadLinks = async () => {
      setIsLoadingLinks(true);
      setError(null);

      try {
        // One resolver call returns the links together with each resource's title, space and URL;
        // the permission check on the backend had to fetch them anyway.
        const data = await getIssuePanelData(contextIssueKey);
        if (!cancelled) {
          setLinkedPages(data.linkedPages);
          setWarning(data.truncated ? truncationWarning(data.linkedPages.length) : null);
        }
      } catch (loadError) {
        console.error('Error loading linked resources:', loadError);
        if (!cancelled) {
          // Previously this failed silently and the table just looked empty.
          setError(toLoadError(loadError));
          setLinkedPages([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLinks(false);
        }
      }
    };

    void loadLinks();

    return () => {
      cancelled = true;
    };
  }, [contextIssueKey]);

  const onRemovePage = useCallback(async (pageId: string, contentId: string, issueKey: string) => {
    setIsUpdating(true);
    setError(null);
    try {
      await unlinkContentFromTicket(contentId, issueKey);
      setLinkedPages((currentPages) => currentPages.filter((page) => page.id !== pageId));
    } catch (removeError) {
      console.error('Error unlinking resource:', removeError);
      setError(toUnlinkError(removeError));
    } finally {
      setIsUpdating(false);
    }
  }, []);

  /**
   * Every supported type, always.
   *
   * There is no type filter in the UI: with only two kinds of content, the per-row icon tells
   * the user what each result is far more cheaply than a filter control, and relevance ranking
   * handles the rest. The backend still takes a type list, so this stays explicit rather than
   * relying on its default.
   */
  const effectiveTypes = useMemo<ContentType[]>(() => [...CONTENT_TYPES], []);

  // Debounced search. The results list is not cleared while loading: keeping the previous rows
  // visible under a spinner avoids the list collapsing and re-expanding on every keystroke.
  //
  // Nothing is searched while the picker is closed. That keeps the panel from spending a
  // Confluence request on every issue the user merely opens.
  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }

    const trimmedQuery = query.trim();
    const isRecent = trimmedQuery.length === 0;

    // Below the floor there is nothing sensible to search for, but the recent list is still
    // worth showing, so only a partial query (never an empty one) suppresses the request.
    if (!isRecent && trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return;
    }

    searchGenerationRef.current += 1;
    const generation = searchGenerationRef.current;
    let isActive = true;

    setSearchState((current) => ({ ...current, loading: true, error: '' }));

    const timeoutId = setTimeout(async () => {
      try {
        const page = await searchConfluenceContent(trimmedQuery, effectiveTypes);
        if (isActive && generation === searchGenerationRef.current) {
          setSearchState({
            loading: false,
            loadingMore: false,
            error: '',
            results: page.results,
            nextCursor: page.nextCursor,
            hasSearched: true,
            resolvedFromLink: page.resolvedFromLink,
            isRecent
          });
        }
      } catch (searchError) {
        console.error('Error searching Confluence:', searchError);
        if (isActive && generation === searchGenerationRef.current) {
          setSearchState({
            ...initialSearchState,
            error: toSearchError(searchError),
            hasSearched: true,
            isRecent
          });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [query, effectiveTypes, isPickerOpen]);

  const onLoadMore = useCallback(async () => {
    const cursor = searchState.nextCursor;
    if (!cursor || searchState.loadingMore) {
      return;
    }

    // Captured before the request so a query change mid-flight discards this page rather than
    // appending results from a search the user has already moved on from.
    const generation = searchGenerationRef.current;
    setSearchState((current) => ({ ...current, loadingMore: true, error: '' }));

    try {
      const page = await searchConfluenceContent(query.trim(), effectiveTypes, cursor);
      if (generation !== searchGenerationRef.current) {
        return;
      }

      setSearchState((current) => ({
        ...current,
        loadingMore: false,
        results: current.results.concat(page.results),
        nextCursor: page.nextCursor
      }));
    } catch (loadMoreError) {
      console.error('Error loading more Confluence results:', loadMoreError);
      if (generation === searchGenerationRef.current) {
        // The rows already on screen stay: only the extra page failed.
        setSearchState((current) => ({ ...current, loadingMore: false, error: toSearchError(loadMoreError) }));
      }
    }
  }, [query, effectiveTypes, searchState.nextCursor, searchState.loadingMore]);

  const onSelectResult = useCallback(
    async (result: SearchContentResult) => {
      if (!contextIssueKey) {
        setError('Could not determine the current issue');
        return;
      }

      setIsUpdating(true);
      setPendingContentId(result.id);
      setError(null);
      try {
        // The content type is not sent: the resolver reads it from Confluence itself.
        await linkContentToTicket(result.id, contextIssueKey);

        setLinkedPages((currentPages) => {
          if (currentPages.some((linkedPage) => linkedPage.contentId === result.id)) {
            return currentPages;
          }
          return currentPages.concat(toLinkedPageFromSearch(result, contextIssueKey));
        });
      } catch (addError) {
        console.error('Error linking resource:', addError);
        setError(toLinkError(addError));
      } finally {
        setIsUpdating(false);
        setPendingContentId(null);
      }
    },
    [contextIssueKey]
  );

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
  }, []);

  const onOpenPicker = useCallback(() => {
    setIsPickerOpen(true);
  }, []);

  /**
   * Closing resets the search back to its opening state.
   *
   * Reopening the dialog to find the previous query and its stale results still sitting there
   * is worse than a clean slate: the recent-content list is a more useful starting point, and
   * the results may no longer reflect what has since been linked.
   */
  const onClosePicker = useCallback(() => {
    setIsPickerOpen(false);
    setQuery('');
    setSearchState(initialSearchState);
    // Any response still in flight belongs to the closed dialog and must not land.
    searchGenerationRef.current += 1;
  }, []);

  const sortedLinkedPages = useMemo(() => {
    return [...linkedPages].sort(
      (first, second) => (first.linkedAt ?? first.updatedAt ?? 0) - (second.linkedAt ?? second.updatedAt ?? 0)
    );
  }, [linkedPages]);

  const linkedContentIds = useMemo(() => {
    return linkedPages.map((page) => page.contentId);
  }, [linkedPages]);

  return {
    isLoadingLinks,
    isUpdating,
    linkedPages: sortedLinkedPages,
    error,
    warning,
    searchState,
    query,
    isPickerOpen,
    linkedContentIds,
    pendingContentId,
    onQueryChange,
    onOpenPicker,
    onClosePicker,
    onSelectResult,
    onLoadMore,
    onRemovePage
  };
};
