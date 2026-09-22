import { describe, expect, it } from 'vitest';
import {
  findQueryMatches,
  formatResourceTooltip,
  formatResultSpace,
  formatUpdatedAt,
  splitHighlights
} from './format';

describe('formatUpdatedAt', () => {
  it('returns fallback for null date', () => {
    expect(formatUpdatedAt(null)).toBe('Updated: -');
  });

  it('returns formatted date for valid timestamp', () => {
    expect(formatUpdatedAt(1725494400000)).toContain('Updated:');
  });
});

describe('splitHighlights', () => {
  it('returns a single plain run when nothing matched', () => {
    expect(splitHighlights('SSO runbook', [])).toEqual([{ text: 'SSO runbook', isMatch: false }]);
  });

  it('splits the text around a match', () => {
    expect(splitHighlights('SSO runbook', [{ start: 4, end: 11 }])).toEqual([
      { text: 'SSO ', isMatch: false },
      { text: 'runbook', isMatch: true }
    ]);
  });

  it('merges overlapping ranges so no character is duplicated', () => {
    // Two search terms hitting the same word would otherwise emit "run" twice.
    const segments = splitHighlights('runbook', [
      { start: 0, end: 3 },
      { start: 2, end: 7 }
    ]);

    expect(segments.map((segment) => segment.text).join('')).toBe('runbook');
    expect(segments).toEqual([{ text: 'runbook', isMatch: true }]);
  });

  it('sorts out-of-order ranges rather than reordering the text', () => {
    const segments = splitHighlights('alpha beta', [
      { start: 6, end: 10 },
      { start: 0, end: 5 }
    ]);

    expect(segments.map((segment) => segment.text).join('')).toBe('alpha beta');
  });

  it('clamps a range that runs past the end of the text', () => {
    expect(splitHighlights('abc', [{ start: 1, end: 99 }])).toEqual([
      { text: 'a', isMatch: false },
      { text: 'bc', isMatch: true }
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(splitHighlights('', [{ start: 0, end: 2 }])).toEqual([]);
  });
});

describe('findQueryMatches', () => {
  it('matches case-insensitively', () => {
    expect(findQueryMatches('SSO Runbook', 'runbook')).toEqual([{ start: 4, end: 11 }]);
  });

  it('matches each whitespace-separated term independently', () => {
    expect(findQueryMatches('auth gateway', 'gateway auth')).toEqual([
      { start: 5, end: 12 },
      { start: 0, end: 4 }
    ]);
  });

  it('finds every occurrence of a term', () => {
    expect(findQueryMatches('log log', 'log')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 }
    ]);
  });

  it('treats regex characters in the query literally', () => {
    // A user typing "c++" must not blow up the RegExp constructor.
    expect(findQueryMatches('the c++ guide', 'c++')).toEqual([{ start: 4, end: 7 }]);
  });

  it('returns nothing for an empty query', () => {
    expect(findQueryMatches('anything', '   ')).toEqual([]);
  });
});

describe('formatResultSpace', () => {
  const baseResult = {
    id: '1',
    title: 'Runbook',
    spaceKey: 'ENG',
    spaceName: 'Engineering',
    contentType: 'page' as const,
    webUrl: '/wiki/1',
    excerpt: '',
    excerptMatches: [],
    breadcrumb: 'Engineering > Platform',
    lastModified: '3 days ago'
  };

  it('shows the space name, and nothing else from the result', () => {
    // Explicitly not the breadcrumb, the excerpt or the date: the row is two lines by design.
    expect(formatResultSpace(baseResult)).toBe('Engineering');
  });

  it('falls back to the key when the space has no name', () => {
    expect(formatResultSpace({ ...baseResult, spaceName: '' })).toBe('ENG');
  });

  it('returns an empty string when the space is unknown, so the line is dropped', () => {
    expect(formatResultSpace({ ...baseResult, spaceName: '', spaceKey: '' })).toBe('');
  });
});

describe('formatResourceTooltip', () => {
  const baseLink = {
    id: 'link-1',
    contentId: '42',
    issueKey: 'ABC-1',
    title: 'Release notes',
    spaceKey: 'DOC',
    spaceName: 'Docs',
    contentType: 'page' as const,
    status: 'not_started' as const,
    webUrl: '/wiki/42',
    linkedAt: 1,
    updatedAt: null
  };

  it('appends the space name and key', () => {
    expect(formatResourceTooltip(baseLink)).toBe('Release notes - Docs (DOC)');
  });

  it('drops the placeholder space key', () => {
    expect(formatResourceTooltip({ ...baseLink, spaceKey: '-' })).toBe('Release notes - Docs');
  });

  it('returns just the title when the space is unknown', () => {
    expect(formatResourceTooltip({ ...baseLink, spaceName: '', spaceKey: '-' })).toBe('Release notes');
  });

  it('appends the update date, which no longer has a column of its own', () => {
    const tooltip = formatResourceTooltip({ ...baseLink, updatedAt: 1725494400000 });

    expect(tooltip).toContain('Release notes - Docs (DOC)');
    expect(tooltip).toContain('Updated:');
  });

  it('leaves the date out entirely when it is unknown', () => {
    // "Updated: -" is noise in a tooltip; the absence says the same thing more quietly.
    expect(formatResourceTooltip(baseLink)).not.toContain('Updated');
  });
});
