import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  Heading,
  Icon,
  Inline,
  Label,
  Link,
  Select,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Tooltip
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

const selectedTableHead = {
  cells: [
    { key: 'page', content: 'Linked Page' },
    { key: 'space', content: 'Space' },
    { key: 'linkStatus', content: 'Documentation Status' },
    { key: 'actions', content: '' }
  ]
};

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

const getStatusLabel = (status) => {
  const labels = {
    'not_started': 'Not started',
    'ongoing_work': 'Ongoing work',
    'needs_review': 'Needs review',
    'done': 'Done'
  };
  return labels[status] || 'Unknown';
};

const formatUpdatedAt = (updatedAt) => {
  if (!updatedAt) {
    return 'Updated: -';
  }

  const date = new Date(updatedAt);
  if (isNaN(date.getTime())) {
    return 'Updated: -';
  }

  return `Updated: ${date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })}`;
};

const formatSearchOptionLabel = (page) => {
  const spaceLabel = page.spaceName
    ? `${page.spaceName}${page.spaceKey ? ` (${page.spaceKey})` : ''}`
    : (page.spaceKey || '-');
  return `${page.title} • ${spaceLabel}`;
};

const toTableRow = (linkedPage, onRemove, isUpdating) => {
  return {
    key: linkedPage.id,
    cells: [
      {
        key: `${linkedPage.id}-page`,
        content: (
          <Inline space="space.100" alignBlock="center">
            <Icon glyph="page" />
            <Link href={linkedPage.webUrl || `/wiki/pages/viewpage.action?pageId=${linkedPage.id}`} openNewTab>
              {linkedPage.title}
            </Link>
          </Inline>
        )
      },
      {
        key: `${linkedPage.id}-space`,
        content: linkedPage.spaceName && linkedPage.spaceKey ? `${linkedPage.spaceName} - ${linkedPage.spaceKey}` : linkedPage.spaceKey || '-'
      },
      {
        key: `${linkedPage.id}-link-status`,
        content: (
          <Inline space="space.100" alignBlock="center">
            <Icon
              glyph={getStatusIconGlyph(linkedPage.status)}
              color={getStatusIconColor(linkedPage.status)}
              size="medium"
              label={getStatusLabel(linkedPage.status)}
            />
            <Text>{getStatusLabel(linkedPage.status)}</Text>
            <Tooltip text={formatUpdatedAt(linkedPage.updatedAt)}>
              <Icon glyph="information-circle" label="Last updated" size="small" />
            </Tooltip>
          </Inline>
        )
      },
      {
        key: `${linkedPage.id}-actions`,
        content: (
          <Inline space="space.050" alignInline="end">
            <Button 
              appearance="subtle" 
              isDisabled={isUpdating}
              onClick={() => onRemove(linkedPage.id, linkedPage.contentId, linkedPage.issueKey)}
            >
              ✕
            </Button>
          </Inline>
        )
      }
    ]
  };
};

const IssueContext = () => {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState({
    loading: false,
    error: '',
    results: []
  });
  const [selectedSearchOption, setSelectedSearchOption] = useState(null);
  const [linkedPages, setLinkedPages] = useState([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [contextIssueKey, setContextIssueKey] = useState(null);
  const [isLoadingLinks, setIsLoadingLinks] = useState(true);
  const searchInputRef = useRef(null);

  // Get current issue key and user from context
  useEffect(() => {
    const loadContext = async () => {
      try {
        const context = await view.getContext();
        if (context && context.extension && context.extension.issue) {
          setContextIssueKey(context.extension.issue.key);
        }
        if (!context || !context.extension || !context.extension.issue || !context.extension.issue.key) {
          setIsLoadingLinks(false);
        }
      } catch (err) {
        console.error('Could not get context:', err);
        setIsLoadingLinks(false);
      }
    };
    loadContext();
  }, []);

  // Load linked pages for this issue
  useEffect(() => {
    const loadLinks = async () => {
      if (!contextIssueKey) {
        setIsLoadingLinks(false);
        return;
      }

      setIsLoadingLinks(true);
      try {
        const result = await invoke('getLinksForTicket', { issueKey: contextIssueKey });
        
        if (result.success && result.links) {
          // Enrich with confluence page details by fetching each one
          const enrichedLinks = await Promise.all(
            result.links.map(async (link) => {
              try {
                const pageDetails = await invoke('getConfluencePageDetails', { contentId: link.contentId });
                if (pageDetails.success && pageDetails.page) {
                  return {
                    id: link.id,
                    contentId: link.contentId,
                    issueKey: contextIssueKey,
                    title: pageDetails.page.title,
                    spaceKey: pageDetails.page.spaceKey,
                    spaceName: pageDetails.page.spaceName,
                    status: link.status,
                    webUrl: pageDetails.page.webUrl,
                    linkId: link.id
                  };
                }
              } catch (err) {
                console.error(`Error fetching details for content ${link.contentId}:`, err);
              }
              // Fallback if fetch fails
              return {
                id: link.id,
                contentId: link.contentId,
                issueKey: contextIssueKey,
                title: `Content ${link.contentId}`,
                spaceKey: '-',
                spaceName: '',
                status: link.status,
                webUrl: `/wiki/pages/viewpage.action?pageId=${link.contentId}`,
                linkId: link.id
              };
            })
          );
          setLinkedPages(enrichedLinks);
        }
      } catch (err) {
        console.error('Error loading linked pages:', err);
      } finally {
        setIsLoadingLinks(false);
      }
    };

    loadLinks();
  }, [contextIssueKey]);

  const removePage = useCallback((pageId, contentId, issueKey) => {
    setIsUpdating(true);
    invoke('unlinkContentFromTicket', {
      contentId,
      issueKey
    })
      .then(() => {
        setLinkedPages((currentPages) => currentPages.filter((page) => page.id !== pageId));
      })
      .catch((err) => {
        console.error('Error unlinking:', err);
      })
      .finally(() => {
        setIsUpdating(false);
      });
  }, []);

  const addPage = useCallback(async (page) => {
    if (!contextIssueKey) {
      console.error('No issue key available');
      return;
    }

    setIsUpdating(true);
    try {
      await invoke('linkContentToTicket', {
        contentId: page.id,
        contentType: page.type || 'page',
        issueKey: contextIssueKey
      });

      // Add to local state
      setLinkedPages((currentPages) => {
        if (currentPages.some((linkedPage) => linkedPage.contentId === page.id)) {
          return currentPages;
        }

        return currentPages.concat({
          id: page.id,
          contentId: page.id,
          issueKey: contextIssueKey,
          title: page.title,
          spaceKey: page.spaceKey,
          spaceName: page.spaceName,
          status: 'not_started',
          webUrl: page.webUrl
        });
      });
    } catch (err) {
      console.error('Error linking page:', err);
    } finally {
      setIsUpdating(false);
    }
  }, [contextIssueKey]);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      setSearchState({
        loading: false,
        error: '',
        results: []
      });
      return undefined;
    }

    let isActive = true;

    setSearchState({
      loading: true,
      error: '',
      results: []
    });

    const timeoutId = setTimeout(async () => {
      try {
        const response = await invoke('searchConfluencePages', { query: trimmedQuery });
        const results = response && Array.isArray(response.results) ? response.results : [];

        if (isActive) {
          setSearchState({
            loading: false,
            error: '',
            results: results
          });
        }
      } catch (error) {
        console.error(error);

        if (isActive) {
          setSearchState({
            loading: false,
            error: 'We could not load Confluence pages right now.',
            results: []
          });
        }
      }
    }, 300);

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [query]);

  const searchOptions = useMemo(() => {
    return searchState.results
      .map((page) => ({
        label: formatSearchOptionLabel(page),
        value: page.id,
        page
      }));
  }, [searchState.results]);

  const tableRows = useMemo(
    () => linkedPages.map((page) => toTableRow(page, removePage, isUpdating)),
    [removePage, linkedPages, isUpdating]
  );

  const handleSelectInputChange = useCallback((newValue, actionMeta) => {
    if (actionMeta && actionMeta.action !== 'input-change') {
      return;
    }

    setQuery(newValue || '');
  }, []);

  const handleSelectChange = useCallback(async (newValue) => {
    if (!newValue || Array.isArray(newValue)) {
      setSelectedSearchOption(null);
      return;
    }

    const optionPage = newValue.page || null;
    if (optionPage) {
      await addPage(optionPage);
    }

    setSelectedSearchOption(null);
    setQuery('');
    setSearchState({
      loading: false,
      error: '',
      results: []
    });
  }, [addPage]);

  return (
    <Stack space="space.200">
      <Box>
        <Stack space="space.150">
          
          <Stack space="space.100">
            <Label labelFor="confluence-page-search-select">Link a Confluence page</Label>
            <Select
              inputId="confluence-page-search-select"
              id="confluence-page-search-select"
              name="confluence-page-search-select"
              appearance="default"
              isSearchable
              isLoading={searchState.loading}
              isClearable={false}
              placeholder="Search Confluence"
              onInputChange={handleSelectInputChange}
              options={searchOptions}
              value={selectedSearchOption}
              onChange={handleSelectChange}
              ref={searchInputRef}
            />
          </Stack>

          {searchState.error ? (
            <SectionMessage appearance="error" title="Search failed">
              <Text>{searchState.error}</Text>
            </SectionMessage>
          ) : null}

          {isLoadingLinks ? (
            <Spinner />
          ) : linkedPages.length === 0 ? (
            <EmptyState
              header="No linked documentation"
              description="Search and select Confluence pages to link them to this ticket."
              primaryAction={{
                text: 'Add a new element',
                onClick: () => {
                  if (searchInputRef.current) {
                    searchInputRef.current.focus();
                  }
                }
              }}
            />
          ) : (
            <DynamicTable
              head={selectedTableHead}
              rows={tableRows}
              isFixedSize
              rowsPerPage={10}
              emptyView="No linked documentation currently."
            />
          )}
        </Stack>
      </Box>
    </Stack>
  );
};

ForgeReconciler.render(<IssueContext />);
