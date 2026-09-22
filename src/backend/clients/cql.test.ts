import { describe, expect, it } from 'vitest';
import { buildIdsCql, buildRecentCql, buildSearchCql, escapeCqlString, sanitiseTextTerm } from './cql';

describe('cql', () => {
  describe('escapeCqlString', () => {
    it('escapes backslashes and double quotes', () => {
      expect(escapeCqlString('a"b')).toBe('a\\"b');
      expect(escapeCqlString('a\\b')).toBe('a\\\\b');
      // Backslashes must be escaped first, or the escaped quote gets broken.
      expect(escapeCqlString('a\\"b')).toBe('a\\\\\\"b');
    });
  });

  describe('sanitiseTextTerm', () => {
    it('strips Lucene operators and collapses the resulting whitespace', () => {
      expect(sanitiseTextTerm('C++ guide')).toBe('C guide');
      expect(sanitiseTextTerm('foo:bar')).toBe('foo bar');
      expect(sanitiseTextTerm('  spaced   out  ')).toBe('spaced out');
    });

    it('leaves ordinary words untouched', () => {
      expect(sanitiseTextTerm('SSO runbook')).toBe('SSO runbook');
    });

    it('reduces a query of pure operators to nothing', () => {
      expect(sanitiseTextTerm('***')).toBe('');
    });
  });

  describe('buildSearchCql', () => {
    it('matches both title prefix and body text, with no ORDER BY', () => {
      const cql = buildSearchCql({ query: 'runbook', types: ['page', 'blogpost'] });

      expect(cql).toBe('(title ~ "runbook*" OR text ~ "runbook") AND type IN (page, blogpost)');
      // Relevance ranking only survives when we do not impose our own ordering.
      expect(cql).not.toContain('ORDER BY');
    });

    it('narrows to a single type', () => {
      expect(buildSearchCql({ query: 'x', types: ['blogpost'] })).toContain('type IN (blogpost)');
    });

    it('falls back to every supported type when the selection is empty', () => {
      expect(buildSearchCql({ query: 'x', types: [] })).toContain('type IN (page, blogpost)');
    });

    it('ignores unsupported types rather than injecting them', () => {
      const cql = buildSearchCql({ query: 'x', types: ['whiteboard' as 'page'] });

      expect(cql).toContain('type IN (page, blogpost)');
      expect(cql).not.toContain('whiteboard');
    });

    it('quotes space keys so keys starting with a digit still parse', () => {
      const cql = buildSearchCql({ query: 'x', types: ['page'], spaceKeys: ['3C', 'ENG'] });

      expect(cql).toContain('space IN ("3C", "ENG")');
    });

    it('omits the space clause when no keys are given', () => {
      expect(buildSearchCql({ query: 'x', types: ['page'], spaceKeys: ['  '] })).not.toContain('space IN');
    });

    it('neutralises an injection attempt in the query', () => {
      const cql = buildSearchCql({ query: 'a" OR type = attachment OR "', types: ['page'] });

      // The double quotes are stripped as Lucene operators, so they can never close the
      // literal and escape into the query. What is left is inert text inside the quotes.
      expect(cql).not.toContain('"a"');
      expect(cql).toBe(
        '(title ~ "a OR type = attachment OR*" OR text ~ "a OR type = attachment OR") AND type IN (page)'
      );
    });

    it('rejects a query that sanitises away to nothing', () => {
      expect(() => buildSearchCql({ query: '***', types: ['page'] })).toThrow();
    });
  });

  describe('buildRecentCql', () => {
    it('orders by last modified, since there is no relevance score to preserve', () => {
      expect(buildRecentCql({ types: ['page', 'blogpost'] })).toBe(
        'type IN (page, blogpost) AND contributor = currentUser() ORDER BY lastmodified DESC'
      );
    });

    it('applies the space filter before the ordering', () => {
      expect(buildRecentCql({ types: ['page'], spaceKeys: ['ENG'] })).toBe(
        'type IN (page) AND contributor = currentUser() AND space IN ("ENG") ORDER BY lastmodified DESC'
      );
    });
  });

  describe('buildIdsCql', () => {
    it('builds an id lookup', () => {
      expect(buildIdsCql(['1', '2'])).toBe('id in (1,2)');
    });
  });
});
