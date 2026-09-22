import {
  Box,
  DynamicTable,
  Icon,
  Image,
  Inline,
  Link,
  Popup,
  Pressable,
  SectionMessage,
  Stack,
  Text,
  Tooltip,
  User
} from '@forge/react';
import {
  getStatusIconColor,
  getStatusIconGlyph,
  getStatusLabel,
  getValidTransitions,
  type LinkStatus
} from '../../../shared/status';
import type { BylineItemViewModel, ContentLink, PageContext } from '../types';

/**
 * Presentational component for the Confluence byline panel.
 *
 * It renders whatever the view model contains and calls back into it - no data fetching, no
 * `invoke`, no direct imports from hooks or services (enforced by an ESLint rule).
 */

const tableHead = {
  cells: [
    { key: 'key', content: 'Issue Key', width: 20 },
    { key: 'summary', content: 'Summary', width: 45 },
    { key: 'status', content: 'Status', width: 35 }
  ]
};

/**
 * Explicit widths, because the history table's columns carry very different loads: the date is
 * the longest string by far and would otherwise starve the rest, while the version is four
 * characters that never grow.
 *
 * "Done by" is narrow because it renders an avatar with `hideDisplayName` - a fixed-size circle
 * plus the header word, and nothing that grows. The width it used to need for a display name is
 * given to the date, which is the one column that was actually truncating.
 *
 * The version column is right-aligned - both header and cell - so the "v" numbers line up as a
 * column of figures rather than drifting with the gap left by the wider cells beside them.
 */
const historyTableHead = {
  cells: [
    { key: 'transition', content: 'Transition', width: 30 },
    { key: 'applied-at', content: 'Date', width: 45 },
    { key: 'applied-by', content: 'Done by', width: 15 },
    {
      key: 'version',
      content: (
        <Inline alignInline="end" grow="fill">
          <Text weight="medium">Ver.</Text>
        </Inline>
      ),
      width: 10
    }
  ]
};

const mainTableEmptyView = <Text>No Jira issues have been linked to this Confluence page yet.</Text>;

const historyTableEmptyView = <Text>No transition history has been recorded yet.</Text>;

interface BylineItemViewProps {
  model: BylineItemViewModel;
}

const renderTransitionOption = (
  link: ContentLink,
  targetStatus: LinkStatus,
  onApply: (status: LinkStatus) => void
) => (
  <Pressable
    backgroundColor="color.background.neutral.subtle"
    key={`${link.id}-${targetStatus}`}
    onClick={() => {
      onApply(targetStatus);
    }}
    padding="space.100"
  >
    <Inline space="space.050" alignBlock="center">
      <Icon glyph="arrow-right" label="Transition arrow" size="small" />
      <Icon
        glyph={getStatusIconGlyph(targetStatus)}
        color={getStatusIconColor(targetStatus)}
        size="medium"
        label={getStatusLabel(targetStatus)}
      />
      <Text>{getStatusLabel(targetStatus)}</Text>
    </Inline>
  </Pressable>
);

const formatDateTime = (dateMs: number): string => {
  if (!Number.isFinite(dateMs) || dateMs <= 0) {
    return '-';
  }

  const date = new Date(dateMs);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
};

/** Confluence history URLs use '+' rather than '%20' for spaces in the title segment. */
const toWikiPathSegment = (value: string): string => {
  return encodeURIComponent(value).replace(/%20/g, '+');
};

/**
 * Builds a deep link to the exact page revision a transition was made against.
 *
 * Returns null when any ingredient is missing (including the site URL, which comes from the
 * Forge context) so the view can fall back to plain text instead of rendering a broken link.
 */
const getHistoryVersionLink = (
  pageContext: PageContext,
  link: ContentLink,
  transitionVersion: number
): string | null => {
  if (transitionVersion <= 0 || !pageContext.siteUrl || !pageContext.pageSpaceKey || !pageContext.pageTitle) {
    return null;
  }

  return `${pageContext.siteUrl}/wiki/spaces/${toWikiPathSegment(
    pageContext.pageSpaceKey
  )}/history/${toWikiPathSegment(link.contentId)}/${toWikiPathSegment(pageContext.pageTitle)}?version1=${transitionVersion}`;
};

/**
 * Builds a link to a person's profile.
 *
 * Absolute, and built from the site URL exactly like the version link above, so it cannot depend
 * on how a relative path happens to resolve inside the Forge iframe. Returns null when the site
 * URL is missing, so the caller can render a plain, unlinked user instead of a dead link.
 */
const getProfileLink = (pageContext: PageContext, accountId: string): string | null => {
  return pageContext.siteUrl ? `${pageContext.siteUrl}/jira/people/${encodeURIComponent(accountId)}` : null;
};

const renderIssueTypeCellIcon = (link: ContentLink) => {
  if (link.issueTypeIconUrl) {
    return (
      <Box xcss={{ width: '14px', height: '14px', display: 'inline-block', overflow: 'hidden' }}>
        <Image src={link.issueTypeIconUrl} alt={link.issueTypeName || 'Issue type'} width="14px" height="14px" />
      </Box>
    );
  }

  return <Icon glyph="issue" label={link.issueTypeName || 'Issue type'} size="small" color="color.icon.subtle" />;
};

export const BylineItemView = ({ model }: BylineItemViewProps) => {
  const errorBanner = model.error ? (
    <SectionMessage appearance="error" title="Something went wrong">
      <Text>{model.error}</Text>
    </SectionMessage>
  ) : null;

  // Shown when the page has more links than one read returns. Informational, not an error -
  // what is on screen is correct, just not the whole set.
  const warningBanner = model.warning ? (
    <SectionMessage appearance="warning" title="Not all links are shown">
      <Text>{model.warning}</Text>
    </SectionMessage>
  ) : null;

  const selectedDetailsLink = model.selectedDetailsLinkId
    ? model.links.find((link) => link.id === model.selectedDetailsLinkId) || null
    : null;

  if (selectedDetailsLink) {
    const sortedHistoryItems = [...model.historyItems].sort((a, b) => b.transitionedAt - a.transitionedAt);
    const historyRows = sortedHistoryItems.map((entry) => {
      const historyVersionLink = getHistoryVersionLink(model.pageContext, selectedDetailsLink, entry.transitionVersion);
      const accountId = entry.transitionedByAccountId;
      const profileLink = accountId ? getProfileLink(model.pageContext, accountId) : null;

      return {
        key: entry.id,
        cells: [
          {
            key: `${entry.id}-transition`,
            content: (
              <Inline space="space.050" alignBlock="center">
                <Icon
                  glyph={getStatusIconGlyph(entry.status)}
                  color={getStatusIconColor(entry.status)}
                  size="medium"
                  label={getStatusLabel(entry.status)}
                />
                <Text>{getStatusLabel(entry.status)}</Text>
              </Inline>
            )
          },
          {
            key: `${entry.id}-applied-at`,
            content: (
              // The full timestamp rarely fits in 35% of a byline panel, so it truncates to one
              // line and the tooltip carries the exact value. `maxLines` needs the table's
              // `isFixedSize`, which is set below.
              <Tooltip content={formatDateTime(entry.transitionedAt)}>
                <Text maxLines={1}>{formatDateTime(entry.transitionedAt)}</Text>
              </Tooltip>
            )
          },
          {
            key: `${entry.id}-applied-by`,
            content: !accountId ? (
              <Text>Unknown user</Text>
            ) : profileLink ? (
              // The avatar alone: in a 20%-wide column the display name truncated to near
              // uselessness, and the avatar's own hover card already names the person. The
              // tooltip says where the click leads rather than restating that name.
              <Tooltip content="View profile">
                <Link href={profileLink} openNewTab>
                  <User accountId={accountId} hideDisplayName />
                </Link>
              </Tooltip>
            ) : (
              // No site URL means no reliable destination; a link that goes nowhere is worse
              // than plain text.
              <User accountId={accountId} hideDisplayName />
            )
          },
          {
            key: `${entry.id}-version`,
            content: (
              <Inline alignInline="end" grow="fill">
                {historyVersionLink ? (
                  <Link href={historyVersionLink} openNewTab>
                    <Text>{`v${entry.transitionVersion}`}</Text>
                  </Link>
                ) : (
                  <Text>{entry.transitionVersion > 0 ? `v${entry.transitionVersion}` : '-'}</Text>
                )}
              </Inline>
            )
          }
        ]
      };
    });

    return (
      <Box padding="space.100">
        <Stack space="space.050">
          {errorBanner}
          <Inline space="space.100" alignBlock="center">
            <Pressable
              backgroundColor="color.background.neutral.subtle"
              onClick={model.goBackToTable}
              padding="space.050"
            >
              <Icon glyph="arrow-left" label="Back to linked Jira table" size="medium" />
            </Pressable>
            <Text weight="bold">
              History :
              <Link href={`/browse/${selectedDetailsLink.issueKey}`} openNewTab>
                {` ${selectedDetailsLink.issueKey} `}
              </Link>
              {` - ${selectedDetailsLink.summary}`}
            </Text>
          </Inline>

          <Box paddingBlockStart="space.200">
            {model.historyError ? (
              <SectionMessage appearance="error" title="History unavailable">
                <Text>{model.historyError}</Text>
              </SectionMessage>
            ) : (
              <DynamicTable
                head={historyTableHead}
                rows={historyRows}
                isLoading={model.historyLoading}
                isFixedSize
                rowsPerPage={5}
                emptyView={historyTableEmptyView}
              />
            )}
          </Box>
        </Stack>
      </Box>
    );
  }

  const rows = model.links.map((link) => {
    const validTransitions = getValidTransitions(link.status);
    const menuOpen = model.openStatusMenuLinkId === link.id;

    return {
      key: link.id,
      cells: [
        {
          key: `${link.id}-key`,
          content: (
            <Inline space="space.050" alignBlock="center" alignInline="start">
              {renderIssueTypeCellIcon(link)}
              <Link href={`/browse/${link.issueKey}`} openNewTab>
                <Text weight="bold">{link.issueKey}</Text>
              </Link>
            </Inline>
          )
        },
        {
          key: `${link.id}-summary`,
          content: (
            <Tooltip content={link.summary}>
              <Text maxLines={1}>{link.summary}</Text>
            </Tooltip>
          )
        },
        {
          key: `${link.id}-status`,
          content: (
            <Inline space="space.100" alignBlock="center" spread="space-between">
              <Popup
                isOpen={menuOpen}
                onClose={model.closePopup}
                shouldIgnoreCloseEvent={(event) => Boolean(event && 'type' in event && event.type === 'click')}
                shouldRenderToParent
                shouldUseCaptureOnOutsideClick
                shouldFitViewport
                role="menu"
                label="Workflow transition menu"
                placement="bottom-start"
                content={() =>
                  validTransitions.length > 0 ? (
                    <Box padding="space.100">
                      <Stack space="space.050">
                        {validTransitions.map((targetStatus) =>
                          renderTransitionOption(link, targetStatus, async (status) => {
                            await model.onUpdateStatus(link.issueKey, link.contentId, status);
                            model.closePopup();
                          })
                        )}
                      </Stack>
                    </Box>
                  ) : (
                    <Box padding="space.100">
                      <Stack space="space.100">
                        <Text>{`No transition is possible for ${link.issueKey}.`}</Text>
                      </Stack>
                    </Box>
                  )
                }
                trigger={() => (
                  <Pressable
                    backgroundColor="color.background.neutral.subtle"
                    onClick={() => {
                      if (menuOpen) {
                        model.closePopup();
                      } else {
                        model.openMenuForLink(link.id);
                      }
                    }}
                    padding="space.050"
                    isDisabled={model.isUpdating}
                  >
                    <Inline space="space.050" alignBlock="center">
                      <Icon
                        glyph={getStatusIconGlyph(link.status)}
                        color={getStatusIconColor(link.status)}
                        size="medium"
                        label={getStatusLabel(link.status)}
                      />
                      <Text size="small">{getStatusLabel(link.status)}</Text>
                    </Inline>
                  </Pressable>
                )}
              />
              <Pressable
                backgroundColor="color.background.neutral.subtle"
                onClick={() => {
                  model.openDetailsForLink(link.id);
                }}
                padding="space.050"
                isDisabled={model.isUpdating}
              >
                <Inline space="space.050" alignBlock="center">
                  {/* The details view lists the issue's transition history, so a "child work
                      items" glyph describes the destination better than a generic (i): this is
                      a drill-down into related work, not a definition of a term. */}
                  <Icon glyph="child-work-items" label="Open issue details" size="medium" />
                </Inline>
              </Pressable>
            </Inline>
          )
        }
      ]
    };
  });

  return (
    <Stack space="space.150">
      {errorBanner}
      {warningBanner}
      <DynamicTable
        head={tableHead}
        rows={rows}
        isLoading={model.isLoading}
        isFixedSize
        rowsPerPage={5}
        emptyView={mainTableEmptyView}
      />
    </Stack>
  );
};
