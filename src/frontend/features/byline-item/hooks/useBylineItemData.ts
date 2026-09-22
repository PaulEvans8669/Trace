import { useCallback, useEffect, useMemo, useState } from 'react';
import { isConflictError } from '../../../shared/resolverClient';
import type { LinkStatus } from '../../../shared/status';
import type { BylineItemViewModel, ContentLink, LinkTransitionHistoryItem, PageContext } from '../types';
import {
  emptyPageContext,
  getBylineContext,
  getBylineData,
  getLinkTransitionHistory,
  toBylineError,
  toStatusUpdateError,
  truncationWarning,
  updateLinkStatus
} from '../services/bylineItemService';

/**
 * State for the Confluence byline panel.
 *
 * Holds the linked issues, the currently open transition menu, and the drill-down history view,
 * and exposes them as a single view model so the component stays purely presentational.
 */
export const useBylineItemData = (): BylineItemViewModel => {
  const [links, setLinks] = useState<ContentLink[]>([]);
  const [pageContext, setPageContext] = useState<PageContext>(emptyPageContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [openStatusMenuLinkId, setOpenStatusMenuLinkId] = useState<string | null>(null);
  const [selectedDetailsLinkId, setSelectedDetailsLinkId] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<LinkTransitionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /**
   * Fetches the whole panel in one resolver call. Extracted from the mount effect so the
   * conflict path below can reuse it to resynchronise with the server.
   */
  const loadPanel = useCallback(async (): Promise<void> => {
    const { contentId, siteUrl } = await getBylineContext();
    if (!contentId) {
      throw new Error('Could not determine content ID');
    }

    const data = await getBylineData(contentId);
    setLinks(data.links);
    setPageContext({ siteUrl, pageTitle: data.pageTitle, pageSpaceKey: data.pageSpaceKey });
    setWarning(data.truncated ? truncationWarning(data.links.length) : null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        await loadPanel();
      } catch (loadError) {
        console.error('Error loading links:', loadError);
        if (!cancelled) {
          setError(toBylineError(loadError));
          setLinks([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPanel]);

  // Keyed on the id (not the object) so re-rendering the list after a status change does not
  // retrigger the history fetch below.
  const activeDetailsLink = useMemo(
    () => links.find((link) => link.id === selectedDetailsLinkId) || null,
    [links, selectedDetailsLinkId]
  );
  const activeDetailsContentId = activeDetailsLink?.contentId ?? null;
  const activeDetailsIssueKey = activeDetailsLink?.issueKey ?? null;

  useEffect(() => {
    if (!activeDetailsContentId || !activeDetailsIssueKey) {
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryItems([]);

    void (async () => {
      try {
        const loadedHistory = await getLinkTransitionHistory(activeDetailsContentId, activeDetailsIssueKey);
        if (!cancelled) {
          setHistoryItems(loadedHistory);
        }
      } catch (loadError) {
        console.error('Error loading transition history:', loadError);
        if (!cancelled) {
          setHistoryError('Could not load transition history');
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDetailsContentId, activeDetailsIssueKey]);

  const onUpdateStatus = useCallback(
    async (issueKey: string, contentId: string, status: LinkStatus) => {
      setIsUpdating(true);
      setError(null);
      try {
        const transitionMetadata = await updateLinkStatus(contentId, issueKey, status);
        setLinks((prevLinks) =>
          prevLinks.map((link) =>
            link.issueKey === issueKey && link.contentId === contentId
              ? {
                  ...link,
                  status,
                  updatedAt: transitionMetadata.updatedAt,
                  transitionVersion: transitionMetadata.transitionVersion
                }
              : link
          )
        );

        // If the history drill-down is open for this link, pull in the new entry.
        if (selectedDetailsLinkId && activeDetailsIssueKey === issueKey) {
          const refreshedHistory = await getLinkTransitionHistory(contentId, issueKey);
          setHistoryItems(refreshedHistory);
        }
      } catch (updateError) {
        console.error('Error updating status:', updateError);
        setError(toStatusUpdateError(updateError));

        // A CONFLICT means somebody else moved this link while the panel was open, so what is
        // on screen is stale. Reloading turns "your click did nothing" into "here is what the
        // link actually looks like now" - and the transitions offered next will be the legal
        // ones. Branching on the machine-readable code rather than on the message text is the
        // whole reason the resolver returns an error envelope.
        if (isConflictError(updateError)) {
          try {
            await loadPanel();
          } catch (refreshError) {
            console.error('Could not refresh after conflict:', refreshError);
          }
        }
      } finally {
        setIsUpdating(false);
      }
    },
    [activeDetailsIssueKey, loadPanel, selectedDetailsLinkId]
  );

  const openMenuForLink = useCallback((linkId: string) => {
    setOpenStatusMenuLinkId(linkId);
  }, []);

  const openDetailsForLink = useCallback((linkId: string) => {
    setSelectedDetailsLinkId(linkId);
    setOpenStatusMenuLinkId(null);
  }, []);

  const closePopup = useCallback(() => {
    setOpenStatusMenuLinkId(null);
  }, []);

  const goBackToTable = useCallback(() => {
    setSelectedDetailsLinkId(null);
    setHistoryItems([]);
    setHistoryError(null);
    setHistoryLoading(false);
  }, []);

  // Oldest link first, so the table order stays stable as statuses change.
  const sortedLinks = useMemo(() => {
    return [...links].sort((a, b) => (a.linkedAt ?? a.updatedAt ?? 0) - (b.linkedAt ?? b.updatedAt ?? 0));
  }, [links]);

  return {
    links: sortedLinks,
    pageContext,
    isLoading,
    isUpdating,
    error,
    warning,
    openStatusMenuLinkId,
    selectedDetailsLinkId,
    historyItems,
    historyLoading,
    historyError,
    openMenuForLink,
    openDetailsForLink,
    closePopup,
    goBackToTable,
    onUpdateStatus
  };
};
