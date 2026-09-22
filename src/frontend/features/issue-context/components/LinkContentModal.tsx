import {
  Box,
  Button,
  Icon,
  Inline,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  Textfield,
  Tooltip
} from '@forge/react';
import { ContentTypeIcon } from '../../../shared/components/ContentTypeIcon';
import type { IssueContextViewModel, SearchContentResult } from '../types';
import { findQueryMatches, formatResultSpace, splitHighlights } from '../types/format';

/**
 * The Confluence content picker, presented as a modal.
 *
 * It lives in a modal rather than inline in the panel for space: the issue context panel is a
 * narrow column whose job is to show the linked resources, and a search field plus a results
 * list pushed that table far down the page. Linking is an occasional action, so it earns a
 * button rather than permanent real estate - the same trade-off Jira makes with "Link issue".
 *
 * The list is hand-built from primitives because UI Kit's `Select` accepts only string labels -
 * no icons, no secondary lines, no per-row disabled state, which are exactly what make a result
 * recognisable.
 */

const SEARCH_INPUT_ID = 'confluence-content-search';

/**
 * Renders text with the matched terms in bold.
 *
 * The runs are `Strong` elements *inside one* `Text`, not separate `Text` elements inside an
 * `Inline`. `Inline` is a flex row, so it treats each run as a wrappable item and happily broke
 * titles mid-word ("mobile" / "-api: Architecture overview"). Keeping everything in a single
 * text flow also lets `maxLines` truncate properly.
 */
const renderHighlighted = (text: string, matches: { start: number; end: number }[], keyPrefix: string) => {
  const segments = splitHighlights(text, matches);

  return (
    <Text maxLines={1}>
      {segments.map((segment, index) =>
        segment.isMatch ? <Strong key={`${keyPrefix}-${index}`}>{segment.text}</Strong> : segment.text
      )}
    </Text>
  );
};

interface ResultRowProps {
  result: SearchContentResult;
  query: string;
  isPending: boolean;
  isDisabled: boolean;
  onSelect: (result: SearchContentResult) => Promise<void>;
}

const ResultRow = ({ result, query, isPending, isDisabled, onSelect }: ResultRowProps) => {
  const space = formatResultSpace(result);

  return (
    <Box paddingBlock="space.075" paddingInline="space.050">
      <Inline space="space.200" alignBlock="center" spread="space-between" grow="fill">
        {/* `grow="fill"` on the text column keeps the action pinned right and makes the title
            truncate rather than shove the button off the row. */}
        <Inline space="space.100" alignBlock="center" grow="fill">
          <ContentTypeIcon contentType={result.contentType} />
          {/* `space.0` because the two lines are one unit: `Text` already carries its own line
              height, so any gap here reads as a gap *between* rows rather than inside one, and
              the list loses its rhythm. The excerpt and the breadcrumb used to sit here too -
              three supporting lines made every row tall enough that only a handful fit on
              screen at once. */}
          <Stack space="space.0" grow="fill">
            {renderHighlighted(result.title, findQueryMatches(result.title, query), `${result.id}-title`)}
            {space ? (
              // `as="span"` keeps the subtitle inline-level, so it contributes no block margin
              // of its own and sits tight under the title.
              <Text as="span" size="small" color="color.text.subtlest" maxLines={1}>
                {space}
              </Text>
            ) : null}
          </Stack>
        </Inline>

        {isPending ? <Spinner size="small" label="Linking" /> : null}
        {!isPending ? (
          <Tooltip content="Link to this issue">
            <Button
              appearance="subtle"
              spacing="compact"
              isDisabled={isDisabled}
              iconBefore="link"
              onClick={() => {
                void onSelect(result);
              }}
            >
              Link
            </Button>
          </Tooltip>
        ) : null}
      </Inline>
    </Box>
  );
};

interface LinkContentModalProps {
  model: IssueContextViewModel;
}

export const LinkContentModal = ({ model }: LinkContentModalProps) => {
  const { searchState, query, linkedContentIds, pendingContentId } = model;

  /**
   * Content already linked to this issue is removed from the list entirely.
   *
   * It used to stay, greyed out and marked "Linked". Hiding it is better: the picker's whole
   * purpose is to offer things you can act on, and a row that exists only to be un-clickable
   * takes up a slot while answering a question the table behind the dialog already answers.
   *
   * It also gives the click its own feedback - the row you just linked disappears - which
   * matters because the panel's table is hidden behind the modal at that moment.
   */
  const visibleResults = searchState.results.filter((result) => !linkedContentIds.includes(result.id));
  const hasResults = visibleResults.length > 0;

  // Distinguishes "nothing matched" from "everything that matched is already linked": the second
  // is a success, and telling the user so stops them retyping a query that worked perfectly.
  const allMatchesLinked = !hasResults && searchState.results.length > 0;

  // "No matches" is a result, not a failure, so it gets a quiet line rather than the error
  // banner or a full `EmptyState`, which is sized for empty pages and dwarfs a modal body.
  const showNoResults =
    !searchState.loading && !searchState.error && searchState.hasSearched && !hasResults && !allMatchesLinked;

  return (
    <ModalTransition>
      {model.isPickerOpen ? (
        // Focus is left to the search field's own `autoFocus`, so the user can type the moment
        // the dialog appears. (Forge's `Modal.autoFocus` only accepts a ref, not a boolean.)
        <Modal onClose={model.onClosePicker} width="medium" label="Link Confluence content">
          <ModalHeader>
            <ModalTitle>Link Confluence content</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <Stack space="space.150">
              <Textfield
                id={SEARCH_INPUT_ID}
                name={SEARCH_INPUT_ID}
                value={query}
                autoFocus
                placeholder="Search pages and blog posts, or paste a Confluence link"
                elemBeforeInput={
                  <Box paddingInlineStart="space.075">
                    <Icon glyph="search" label="" size="small" />
                  </Box>
                }
                elemAfterInput={
                  searchState.loading ? (
                    <Box paddingInlineEnd="space.075">
                      <Spinner size="small" label="Searching" />
                    </Box>
                  ) : undefined
                }
                onChange={(event) => {
                  // UI Kit passes a synthetic-like event; the value is read defensively because
                  // the exact shape is not part of the public type.
                  const value = (event as unknown as { target?: { value?: string } })?.target?.value;
                  model.onQueryChange(typeof value === 'string' ? value : '');
                }}
              />

              {/* A failed search belongs next to the search box, not in the panel behind it. */}
              {searchState.error ? (
                <SectionMessage appearance="error" title="Search failed">
                  <Text>{searchState.error}</Text>
                </SectionMessage>
              ) : null}

              {searchState.resolvedFromLink ? (
                <Text size="small" color="color.text.subtlest">
                  Resolved from the link you pasted.
                </Text>
              ) : null}

              {!searchState.resolvedFromLink && searchState.isRecent && hasResults ? (
                <Text size="small" color="color.text.subtlest">
                  Recently edited by you
                </Text>
              ) : null}

              {hasResults ? (
                <Stack space="space.0">
                  {visibleResults.map((result) => (
                    <ResultRow
                      key={result.id}
                      result={result}
                      query={searchState.isRecent ? '' : query}
                      isPending={pendingContentId === result.id}
                      isDisabled={model.isUpdating}
                      onSelect={model.onSelectResult}
                    />
                  ))}

                  {/* The closest UI Kit allows to infinite scroll: the list itself scrolls with
                      the modal body, so reaching the end reveals this as the final row. There is
                      no `onScroll` or intersection observer in UI Kit, so the last step cannot
                      be automatic - the page size is large instead, to make it rare. */}
                  {searchState.nextCursor ? (
                    <Box paddingBlock="space.100">
                      <Button
                        appearance="subtle"
                        shouldFitContainer
                        isDisabled={searchState.loadingMore}
                        onClick={() => {
                          void model.onLoadMore();
                        }}
                      >
                        {searchState.loadingMore ? 'Loading more...' : 'Load more results'}
                      </Button>
                    </Box>
                  ) : null}
                </Stack>
              ) : null}

              {allMatchesLinked ? (
                <Text size="small" color="color.text.subtlest">
                  {searchState.isRecent
                    ? 'Everything you edited recently is already linked to this issue.'
                    : 'Everything that matched is already linked to this issue.'}
                </Text>
              ) : null}

              {showNoResults ? (
                <Text size="small" color="color.text.subtlest">
                  {searchState.isRecent
                    ? 'Start typing to search Confluence pages and blog posts.'
                    : 'No matches. Try a different word, or paste the Confluence link directly.'}
                </Text>
              ) : null}
            </Stack>
          </ModalBody>

          <ModalFooter>
            {/* Linking applies immediately, so this only dismisses - there is nothing to submit
                and therefore nothing to cancel. */}
            <Button appearance="primary" onClick={model.onClosePicker}>
              Done
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </ModalTransition>
  );
};
