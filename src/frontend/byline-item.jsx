import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box,
  DynamicTable,
  EmptyState,
  Heading,
  Icon,
  Inline,
  Link,
  Popup,
  Pressable,
  Spinner,
  Stack,
  Text,
  Tooltip
} from '@forge/react';
import { invoke, requestJira, view } from '@forge/bridge';

const getStatusIconGlyph = (status) => {
  const glyphs = {
    'not_started': 'task-to-do',
    'ongoing_work': 'task-in-progress',
    'needs_review': 'status-success',
    'done': 'status-verified'
  };
  return glyphs[status] || 'task-to-do';
};

const getStatusIconColor = (status) => {
  const colors = {
    'not_started': 'color.background.icon.subtle',
    'ongoing_work': 'color.background.accent.yellow.subtle',
    'needs_review': 'color.background.accent.green.subtle',
    'done': 'color.background.brand.bold'
  };
  return colors[status] || 'color.icon.subtle';
};

// Status label mapping
const getStatusLabel = (status) => {
  const labels = {
    'not_started': 'Not started',
    'ongoing_work': 'Ongoing work',
    'needs_review': 'Needs review',
    'done': 'Done'
  };
  return labels[status] || 'Unknown';
};

// Get valid state transitions from current status
const getValidTransitions = (currentStatus) => {
  const transitions = {
    'not_started': ['ongoing_work', 'needs_review', 'done'],
    'ongoing_work': ['needs_review', 'done'],
    'needs_review': ['done'],
    'done': [] // No transitions from done (read-only)
  };
  return transitions[currentStatus] || [];
};

// Format date for display
const formatDate = (dateString) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (err) {
    return '-';
  }
};

const getApprovalInfoText = (link) => {
  const approvedAt = formatDate(link && link.updatedAt ? link.updatedAt : null);
  if (approvedAt === '-') {
    return 'Approved date unavailable';
  }
  return `Approved on ${approvedAt}`;
};

/**
 * BylineItem component - Main Confluence content byline display.
 * Shows all Jira issues linked to the current Confluence content in a DynamicTable.
 * Allows inline status updates via dropdown.
 */
const BylineItem = () => {
  const [links, setLinks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [openStatusMenuLinkId, setOpenStatusMenuLinkId] = useState(null);

  // Get current Confluence page ID from context
  const getContentId = useCallback(async () => {
    try {
      const ctx = await view.getContext();
      if (ctx && ctx.extension && ctx.extension.content && ctx.extension.content.id) {
        return String(ctx.extension.content.id);
      }
      return null;
    } catch (err) {
      console.error('Could not get content ID:', err);
      return null;
    }
  }, []);

  // Fetch Jira issue details for display
  const fetchIssueDetails = useCallback(async (issueKey) => {
    try {
      const response = await requestJira(`/rest/api/3/issue/${issueKey}`);
      if (!response || !response.ok) {
        throw new Error(`Jira issue lookup failed for ${issueKey}`);
      }

      const data = await response.json();
      const fields = data && data.fields ? data.fields : {};
      return {
        key: data && data.key ? data.key : issueKey,
        summary: fields.summary || issueKey,
        url: data && data.key ? data.key : issueKey
      };
    } catch (err) {
      console.error(`Could not fetch issue ${issueKey}:`, err);
      return { key: issueKey, summary: 'Unknown', url: issueKey };
    }
  }, []);

  // Load links for this content on component mount
  useEffect(() => {
    const loadLinks = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const contentId = await getContentId();
        if (!contentId) {
          setError('Could not determine content ID');
          setIsLoading(false);
          return;
        }

        // Fetch links from database
        const result = await invoke('getLinksForContent', { contentId });

        if (!result.success || !result.links) {
          setLinks([]);
          setIsLoading(false);
          return;
        }

        // Enrich links with issue details
        const enrichedLinks = await Promise.all(
          result.links.map(async (link) => {
            const issueDetails = await fetchIssueDetails(link.issueKey);
            return {
              ...link,
              issueUrl: `/browse/${issueDetails.key}`,
              contentId
            };
          })
        );

        setLinks(enrichedLinks);
      } catch (err) {
        console.error('Error loading links:', err);
        setError('Could not load linked issues');
      } finally {
        setIsLoading(false);
      }
    };

    loadLinks();
  }, [getContentId, fetchIssueDetails]);

  // Handle status update
  const handleStatusUpdate = useCallback(async (issueKey, contentId, newStatus) => {
    setIsUpdating(true);

    try {
      // Get current user info
      await invoke('updateLinkStatus', {
        contentId,
        issueKey,
        newStatus
      });

      // Update local state
      setLinks((prevLinks) =>
        prevLinks.map((link) =>
          link.issueKey === issueKey && link.contentId === contentId
            ? { ...link, status: newStatus }
            : link
        )
      );
    } catch (err) {
      console.error('Error updating status:', err);
      setError('Failed to update status');
    } finally {
      setIsUpdating(false);
    }
  }, []);

  // Sort links by updated_at descending (latest first)
  const sortedLinks = useMemo(() => {
    return [...links].sort((a, b) => {
      const dateA = new Date(a.updatedAt || 0).getTime();
      const dateB = new Date(b.updatedAt || 0).getTime();
      return dateB - dateA; // Latest first
    });
  }, [links]);

  // Build DynamicTable rows with status dropdown and approval info
  const tableRows = useMemo(() => {
    return sortedLinks.map((link) => {
      const validTransitions = getValidTransitions(link.status);
      const isStatusFinal = link.status === 'done';
      const isMenuOpen = openStatusMenuLinkId === link.id;

      return {
        key: link.id,
        cells: [
          {
            key: `${link.id}-key`,
            content: (
              <Link href={`/browse/${link.issueKey}`} openNewTab>
                <Text weight="bold">{link.issueKey}</Text>
              </Link>
            )
          },
          {
            key: `${link.id}-summary`,
            content: link.summary || 'Unknown'
          },
          {
            key: `${link.id}-status`,
            content: (
              <Inline space="space.100" alignBlock="center">
                {isStatusFinal ? (
                  <Inline space="space.100" alignBlock="center">
                    <Icon
                      glyph={getStatusIconGlyph(link.status)}
                      color={getStatusIconColor(link.status)}
                      size="medium"
                      label={getStatusLabel(link.status)}
                    />
                    <Text>{getStatusLabel(link.status)}</Text>
                    <Tooltip text={getApprovalInfoText(link)}>
                      <Icon glyph="information-circle" label="Approval information" size="small" />
                    </Tooltip>
                  </Inline>
                ) : (
                    <Popup
                      isOpen={isMenuOpen}
                      onClose={() => setOpenStatusMenuLinkId(null)}
                      placement="bottom-start"
                      content={() => (
                        <Stack space="space.050" onClick={(e) => e.stopPropagation()}>
                          {validTransitions.map((targetStatus) => (
                            <Pressable
                              backgroundColor={'color.background.neutral.subtle'}
                              key={targetStatus}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStatusUpdate(link.issueKey, link.contentId, targetStatus);
                                setOpenStatusMenuLinkId(null);
                              }}
                              padding="space.100"
                            >
                              <Inline space="space.050" alignBlock="center">
                                <Icon glyph="arrow-right" label="" size="small" />
                                <Icon
                                  glyph={getStatusIconGlyph(targetStatus)}
                                  color={getStatusIconColor(targetStatus)}
                                  size="medium"
                                  label={getStatusLabel(targetStatus)}
                                />
                                <Text>{getStatusLabel(targetStatus)}</Text>
                              </Inline>
                            </Pressable>
                          ))}
                        </Stack>
                      )}
                      trigger={() => (
                        <Pressable
                          backgroundColor={'color.background.neutral.subtle'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenStatusMenuLinkId(isMenuOpen ? null : link.id);
                          }}
                          padding="space.050"
                          isDisabled={isUpdating || validTransitions.length === 0}
                        >
                          <Inline space="space.050" alignBlock="center">
                            <Icon
                              glyph={getStatusIconGlyph(link.status)}
                              color={getStatusIconColor(link.status)}
                              size="medium"
                              label={getStatusLabel(link.status)}
                            />
                            <Text>{getStatusLabel(link.status)}</Text>
                            <Icon glyph="arrow-right" label="" size="small" />
                          </Inline>
                        </Pressable>
                      )}
                    />
                )}
              </Inline>
            )
          }
        ]
      };
    });
  }, [sortedLinks, isUpdating, handleStatusUpdate, openStatusMenuLinkId]);

  const tableHead = {
    cells: [
      { key: 'key', content: 'Issue Key' },
      { key: 'summary', content: 'Summary' },
      { key: 'status', content: 'Status' }
    ]
  };

  // If loading, show spinner
  if (isLoading) {
    return <Spinner size="small" />;
  }

  // If no links, show empty state
  if (links.length === 0) {
    return (
      <EmptyState
        header="No linked issues"
        description="No Jira issues have been linked to this Confluence page yet."
      />
    );
  }

  // Show DynamicTable with all links
  return (
    <Stack space="space.150">
      {error && (
        <Box padding="space.100">
          <Text color="error">{error}</Text>
        </Box>
      )}
      <DynamicTable head={tableHead} rows={tableRows} isFixedSize rowsPerPage={10} />
    </Stack>
  );
};

ForgeReconciler.render(<BylineItem />);
