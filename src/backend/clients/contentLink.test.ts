import { describe, expect, it } from 'vitest';
import { parseContentLink } from './contentLink';

describe('parseContentLink', () => {
  it('reads a bare content id', () => {
    expect(parseContentLink('123456')).toEqual({ contentId: '123456', contentType: null });
    expect(parseContentLink('  123456  ')).toEqual({ contentId: '123456', contentType: null });
  });

  it('reads a page URL and infers the type', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/SSO+Runbook')).toEqual({
      contentId: '123456',
      contentType: 'page'
    });
  });

  it('reads a page URL with no trailing title', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456')).toEqual({
      contentId: '123456',
      contentType: 'page'
    });
  });

  it('reads an edit URL', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/edit-v2/123456')).toEqual({
      contentId: '123456',
      contentType: 'page'
    });
  });

  it('reads a blog URL with its date segments and infers the type', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/blog/2026/01/02/123456/Why+We+Rewrote')).toEqual(
      { contentId: '123456', contentType: 'blogpost' }
    );
  });

  it('reads a blog URL without date segments', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/blog/123456/Post')).toEqual({
      contentId: '123456',
      contentType: 'blogpost'
    });
  });

  it('reads a legacy viewpage link but leaves the type unresolved', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=123456')).toEqual({
      contentId: '123456',
      contentType: null
    });
  });

  it('reads a pageId query parameter that is not the first one', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/overview?foo=1&pageId=123456')).toEqual({
      contentId: '123456',
      contentType: null
    });
  });

  it('strips a trailing anchor or query from the id', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456?focusId=7')?.contentId).toBe(
      '123456'
    );
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456#section')?.contentId).toBe(
      '123456'
    );
  });

  it('treats ordinary search text as search text', () => {
    expect(parseContentLink('SSO runbook')).toBeNull();
    expect(parseContentLink('')).toBeNull();
    expect(parseContentLink('   ')).toBeNull();
    expect(parseContentLink('release 2.0')).toBeNull();
  });

  it('ignores a tiny link, whose id only Confluence can expand', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/x/AbC123')).toBeNull();
  });

  it('does not mistake a non-numeric path segment for an id', () => {
    expect(parseContentLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/overview')).toBeNull();
  });
});
