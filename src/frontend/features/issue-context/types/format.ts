import type { ExcerptMatch, LinkedPage, SearchContentResult } from './index';

export const formatUpdatedAt = (updatedAt: number | null): string => {
  if (!updatedAt) {
    return 'Updated: -';
  }

  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Updated: -';
  }

  return `Updated: ${date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })}`;
};

/** One run of text that is either part of a search match or not. */
export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Splits text into alternating plain and matched runs so the UI can bold what the user searched
 * for. Scanning a result list is much faster when the reason a row matched is visible at a glance.
 *
 * Ranges are sorted and merged first: Confluence can report overlapping or out-of-order
 * highlights (two search terms hitting the same word), and naively slicing those would duplicate
 * or reorder characters, silently corrupting the text on screen.
 */
export const splitHighlights = (text: string, ranges: ExcerptMatch[]): HighlightSegment[] => {
  if (!text) {
    return [];
  }

  const usable = ranges
    .filter((range) => range.start >= 0 && range.end > range.start && range.start < text.length)
    .map((range) => ({ start: range.start, end: Math.min(range.end, text.length) }))
    .sort((first, second) => first.start - second.start);

  if (usable.length === 0) {
    return [{ text, isMatch: false }];
  }

  const merged: ExcerptMatch[] = [];
  for (const range of usable) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), isMatch: false });
    }
    segments.push({ text: text.slice(range.start, range.end), isMatch: true });
    cursor = range.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
  }

  return segments;
};

/** Escapes a user-typed term so it can be used inside a regular expression literally. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds where the query terms appear in a title.
 *
 * Confluence only returns highlight markers for the body excerpt, not the title, so title
 * matches are located locally. Terms are matched case-insensitively and independently, which is
 * close enough to how the CQL `title ~ "foo*"` prefix match behaves.
 */
export const findQueryMatches = (text: string, query: string): ExcerptMatch[] => {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  if (terms.length === 0 || !text) {
    return [];
  }

  const matches: ExcerptMatch[] = [];
  for (const term of terms) {
    const pattern = new RegExp(escapeRegExp(term), 'gi');
    let found = pattern.exec(text);
    while (found !== null) {
      matches.push({ start: found.index, end: found.index + found[0].length });
      // A zero-length match cannot happen here (terms are non-empty), but advancing explicitly
      // keeps the loop safe if that ever changes.
      pattern.lastIndex = found.index + Math.max(found[0].length, 1);
      found = pattern.exec(text);
    }
  }

  return matches;
};

/**
 * The secondary line under a result title: the space the content lives in.
 *
 * Deliberately just the space. This line used to carry the full breadcrumb and the last-modified
 * phrase, and the row carried an excerpt below that - three lines of supporting text for one
 * line of answer, which made the list tall enough that only a handful of results fit on screen.
 * The space is the piece that actually disambiguates, because the same title in two spaces is
 * the case where picking the wrong one is easy.
 *
 * The space name is preferred over the key, which is an internal identifier most readers do not
 * recognise; the key is the fallback only when there is no name.
 */
export const formatResultSpace = (result: SearchContentResult): string => {
  return result.spaceName || result.spaceKey || '';
};

/**
 * Tooltip text for a linked row: the title, the space it lives in, and when it last changed.
 *
 * The space used to have its own table column and the update date its own icon. Both moved here:
 * the table is down to the two things it must answer - what is linked and what state it is in -
 * and the supporting detail is one hover away rather than competing for width.
 */
export const formatResourceTooltip = (linkedPage: LinkedPage): string => {
  const hasSpaceKey = Boolean(linkedPage.spaceKey) && linkedPage.spaceKey !== '-';
  const spaceLabel = linkedPage.spaceName
    ? `${linkedPage.spaceName}${hasSpaceKey ? ` (${linkedPage.spaceKey})` : ''}`
    : (hasSpaceKey ? linkedPage.spaceKey : '');

  const heading = spaceLabel ? `${linkedPage.title} - ${spaceLabel}` : linkedPage.title;

  // An unknown date is left out entirely; "Updated: -" is noise in a tooltip. The middle dot is
  // written as a `\u00b7` escape rather than a literal: this file was once saved through a
  // non-UTF-8 step, which turned the literal into U+FFFD and drew a black diamond in the UI.
  // Keeping the source ASCII-only makes that impossible to repeat.
  return linkedPage.updatedAt ? `${heading} \u00b7 ${formatUpdatedAt(linkedPage.updatedAt)}` : heading;
};
