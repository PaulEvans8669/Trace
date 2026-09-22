import { describe, expect, it } from 'vitest';
import { isSpaceOverviewUrl, isValidContentId, parseHighlightedExcerpt, toPageDetails } from './confluenceClient';

describe('confluenceClient parsing', () => {
  describe('isValidContentId', () => {
    it('accepts numeric ids and rejects anything else', () => {
      expect(isValidContentId('123456')).toBe(true);
      expect(isValidContentId('12a')).toBe(false);
      expect(isValidContentId('')).toBe(false);
      // Guards against CQL injection through the id parameter.
      expect(isValidContentId('1) OR 1=1 --')).toBe(false);
    });
  });

  describe('toPageDetails', () => {
    it('reads a flat result', () => {
      const page = toPageDetails({
        id: '42',
        title: 'Runbook',
        type: 'page',
        space: { key: 'DOC', name: 'Docs' },
        _links: { base: 'https://example.atlassian.net', webui: '/spaces/DOC/pages/42' }
      });

      expect(page).toEqual({
        id: '42',
        title: 'Runbook',
        spaceKey: 'DOC',
        spaceName: 'Docs',
        webUrl: 'https://example.atlassian.net/spaces/DOC/pages/42',
        contentType: 'page',
        isSpaceOverview: false
      });
    });

    it('reads a result nested under content', () => {
      const page = toPageDetails({
        content: {
          id: '43',
          title: 'Nested',
          type: 'blogpost',
          space: { key: 'ENG', name: 'Engineering' },
          _links: { webui: '/spaces/ENG/pages/43' }
        }
      });

      expect(page?.id).toBe('43');
      expect(page?.title).toBe('Nested');
      expect(page?.spaceKey).toBe('ENG');
      expect(page?.contentType).toBe('blogpost');
    });

    it('prefixes a bare /spaces link with /wiki when no base is supplied', () => {
      const page = toPageDetails({ id: '44', _links: { webui: '/spaces/DOC/pages/44' } });

      expect(page?.webUrl).toBe('/wiki/spaces/DOC/pages/44');
    });

    it('keeps an already absolute link untouched', () => {
      const page = toPageDetails({ id: '45', _links: { webui: 'https://example.com/x' } });

      expect(page?.webUrl).toBe('https://example.com/x');
    });

    it('falls back to a viewpage link when no web url is available', () => {
      const page = toPageDetails({ id: '46' });

      expect(page?.webUrl).toBe('/wiki/pages/viewpage.action?pageId=46');
      expect(page?.title).toBe('Untitled page');
    });

    it('returns null when there is no id at all', () => {
      expect(toPageDetails({ title: 'Orphan' })).toBeNull();
    });

    it('uses the fallback id when the payload omits one', () => {
      expect(toPageDetails({ title: 'Orphan' }, '99')?.id).toBe('99');
    });

    it('ignores non-string fields instead of crashing', () => {
      const page = toPageDetails({ id: '47', title: 12345, space: null });

      expect(page?.title).toBe('Untitled page');
      expect(page?.spaceKey).toBe('');
    });

    it('flags the space overview by its expanded homepage id', () => {
      const page = toPageDetails({
        content: {
          id: '50',
          title: 'Docs',
          type: 'page',
          space: { key: 'DOC', name: 'Docs', homepage: { id: '50' } },
          _links: { webui: '/spaces/DOC/pages/50/Docs' }
        }
      });

      expect(page?.isSpaceOverview).toBe(true);
    });

    it('flags the space overview by its url when the homepage was not expanded', () => {
      const page = toPageDetails({
        id: '51',
        title: 'Engineering',
        space: { key: 'ENG', name: 'Engineering' },
        _links: { webui: '/spaces/ENG/overview' }
      });

      expect(page?.isSpaceOverview).toBe(true);
    });

    it('does not mistake an ordinary page for the overview', () => {
      // A different page in the same space, and a page that merely happens to be called
      // "overview", are both linkable.
      const sibling = toPageDetails({
        content: {
          id: '52',
          space: { key: 'DOC', name: 'Docs', homepage: { id: '50' } },
          _links: { webui: '/spaces/DOC/pages/52/Overview+of+auth' }
        }
      });

      expect(sibling?.isSpaceOverview).toBe(false);
    });
  });

  describe('isSpaceOverviewUrl', () => {
    it('matches the overview path with or without a trailing slash, query or fragment', () => {
      expect(isSpaceOverviewUrl('/wiki/spaces/DOC/overview')).toBe(true);
      expect(isSpaceOverviewUrl('https://acme.atlassian.net/wiki/spaces/DOC/overview/')).toBe(true);
      expect(isSpaceOverviewUrl('/wiki/spaces/DOC/overview?src=sidebar')).toBe(true);
      expect(isSpaceOverviewUrl('/wiki/spaces/DOC/overview#top')).toBe(true);
    });

    it('does not match a page that lives under the overview path', () => {
      expect(isSpaceOverviewUrl('/wiki/spaces/DOC/pages/42/Overview')).toBe(false);
      expect(isSpaceOverviewUrl('/wiki/spaces/DOC/overview/child')).toBe(false);
      expect(isSpaceOverviewUrl('')).toBe(false);
    });
  });
});

describe('parseHighlightedExcerpt', () => {
  it('strips the highlight markers and reports where the matches were', () => {
    const parsed = parseHighlightedExcerpt('the @@@hl@@@SSO@@@endhl@@@ runbook');

    expect(parsed.text).toBe('the SSO runbook');
    expect(parsed.matches).toEqual([{ start: 4, end: 7 }]);
  });

  it('handles several matches in one excerpt', () => {
    const parsed = parseHighlightedExcerpt('@@@hl@@@a@@@endhl@@@ and @@@hl@@@b@@@endhl@@@');

    expect(parsed.text).toBe('a and b');
    expect(parsed.matches).toEqual([
      { start: 0, end: 1 },
      { start: 6, end: 7 }
    ]);
  });

  it('collapses the whitespace that page bodies drag in', () => {
    expect(parseHighlightedExcerpt('  line one\n\n  line two  ').text).toBe('line one line two');
  });

  it('drops a stray opening marker rather than rendering it', () => {
    // A truncated excerpt can cut a closing marker off; showing "@@@hl@@@" to the user is worse
    // than losing the emphasis.
    const parsed = parseHighlightedExcerpt('broken @@@hl@@@tail');

    expect(parsed.text).toBe('broken tail');
    expect(parsed.matches).toEqual([]);
  });

  it('drops characters the renderer cannot display', () => {
    // Confluence truncates excerpts by UTF-16 code unit, so an emoji sitting on the boundary
    // loses half its surrogate pair and renders as a black diamond. Better to drop it.
    expect(parseHighlightedExcerpt("G'day \uD83D august 30").text).toBe("G'day august 30");
    expect(parseHighlightedExcerpt('trailing \uDE00 half').text).toBe('trailing half');
    expect(parseHighlightedExcerpt('already \uFFFD broken').text).toBe('already broken');

    // A complete pair is fine and must survive.
    expect(parseHighlightedExcerpt('intact \uD83D\uDE00 emoji').text).toBe('intact \uD83D\uDE00 emoji');
  });

  it('reports match offsets against the cleaned text, not the raw excerpt', () => {
    // Normalisation runs before the marker scan; if it ran after, every offset would shift by
    // the number of characters removed and the wrong words would be bolded.
    const parsed = parseHighlightedExcerpt('  \uFFFD the   @@@hl@@@SSO@@@endhl@@@ runbook ');

    expect(parsed.text).toBe('the SSO runbook');
    expect(parsed.matches).toEqual([{ start: 4, end: 7 }]);
  });

  it('returns nothing for an empty excerpt', () => {
    expect(parseHighlightedExcerpt('')).toEqual({ text: '', matches: [] });
  });
});
