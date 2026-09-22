import { Box, Button, DynamicTable, Icon, Inline, Link, SectionMessage, Stack, Text, Tooltip } from '@forge/react';
import type { IssueContextViewModel } from '../types';
import { getStatusIconColor, getStatusIconGlyph, getStatusLabel } from '../../../shared/status';
import { ContentTypeIcon } from '../../../shared/components/ContentTypeIcon';
import type { LinkedPage } from '../types';
import { formatResourceTooltip } from '../types/format';
import { LinkContentModal } from './LinkContentModal';

/**
 * Explicit widths, as in the byline table: without them a long title stretches its column and
 * squeezes the status and actions cells, which is what made this table look broken. The space
 * column is gone - in a panel this narrow it cost more than it told anyone, and the space now
 * lives in the title's tooltip.
 *
 * The resource column takes the lion's share because it is the only column with variable-length
 * content; the other two render fixed-width chrome, so they hold their shape whatever the title
 * does.
 */
const tableHead = {
  cells: [
    { key: 'resource', content: 'Linked resource', width: 70 },
    {
      key: 'linkStatus',
      content: (
        <Inline alignInline="start" grow="fill">
          <Text weight="medium">Status</Text>
        </Inline>
      ),
      width: 25
    },
    { key: 'actions', content: '', width: 5 }
  ]
};

const linkedDocsEmptyView = (
  <Text>No Confluence content is linked yet. Use "Link content" to search pages and blog posts.</Text>
);

const toTableRow = (
  linkedPage: LinkedPage,
  onRemove: IssueContextViewModel['onRemovePage'],
  isUpdating: boolean
) => ({
  key: linkedPage.id,
  cells: [
    {
      key: `${linkedPage.id}-resource`,
      content: (
        <Inline space="space.100" alignBlock="center" alignInline="start">
          <ContentTypeIcon contentType={linkedPage.contentType} />
          {/* The tooltip carries the full title plus the space, so truncating the visible text
              loses nothing. `maxLines` needs the table's `isFixedSize`, which is set below. */}
          <Tooltip content={formatResourceTooltip(linkedPage)}>
            <Link href={linkedPage.webUrl} openNewTab>
              <Text maxLines={1}>{linkedPage.title}</Text>
            </Link>
          </Tooltip>
        </Inline>
      )
    },
    {
      key: `${linkedPage.id}-link-status`,
      content: (
        <Inline space="space.050" alignBlock="center" alignInline="start" grow="fill">
          <Icon
            glyph={getStatusIconGlyph(linkedPage.status)}
            color={getStatusIconColor(linkedPage.status)}
            size="medium"
            label={getStatusLabel(linkedPage.status)}
          />
          <Text maxLines={1}>{getStatusLabel(linkedPage.status)}</Text>
        </Inline>
      )
    },
    {
      key: `${linkedPage.id}-actions`,
      content: (
        <Inline space="space.050" alignInline="end" alignBlock="center">
          <Tooltip content="Unlink this resource">
            <Button
              appearance="subtle"
              spacing="compact"
              isDisabled={isUpdating}
              onClick={() => onRemove(linkedPage.id, linkedPage.contentId, linkedPage.issueKey)}
            >
              {/* A real icon rather than a multiplication-sign character: it gets a proper
                  accessible name and scales with the rest of the table's iconography. */}
              <Icon glyph="cross" label="Unlink this resource" size="small" />
            </Button>
          </Tooltip>
        </Inline>
      )
    }
  ]
});

interface IssueContextViewProps {
  model: IssueContextViewModel;
}

export const IssueContextView = ({ model }: IssueContextViewProps) => {
  const tableRows = model.linkedPages.map((page) => toTableRow(page, model.onRemovePage, model.isUpdating));

  return (
    <Stack space="space.200">
      <Box>
        <Stack space="space.150">
          {model.error ? (
            <SectionMessage appearance="error" title="Something went wrong">
              <Text>{model.error}</Text>
            </SectionMessage>
          ) : null}

          {/* Informational, not an error: what is shown is correct, just not the whole set. */}
          {model.warning ? (
            <SectionMessage appearance="warning" title="Not all links are shown">
              <Text>{model.warning}</Text>
            </SectionMessage>
          ) : null}

          <DynamicTable
            head={tableHead}
            rows={tableRows}
            isLoading={model.isLoadingLinks}
            isFixedSize
            rowsPerPage={5}
            emptyView={linkedDocsEmptyView}
          />

          {/* Below the table, not above it: the panel's job is to show what is linked, and an
              action placed first pushes that answer down the page. */}
          <Inline alignInline="start">
            <Button appearance="default" iconBefore="add" onClick={model.onOpenPicker}>
              Link content
            </Button>
          </Inline>

          <LinkContentModal model={model} />
        </Stack>
      </Box>
    </Stack>
  );
};
