import { DEFAULT_CONTENT_TYPE, type ContentType } from '../../shared/contentType';

/**
 * Recognises a Confluence link (or a bare content id) pasted into the picker.
 *
 * People share documentation by pasting URLs, not by remembering titles. Without this, pasting
 * a link runs it through the search engine as free text - which usually returns nothing,
 * because a URL shares no words with the page it points at.
 *
 * Only the id and, where the URL reveals it, the content type are extracted here. The caller
 * still looks the content up through the normal permission-checked path, so a fabricated URL
 * grants nothing.
 */

export interface ParsedContentLink {
  contentId: string;
  /** `null` when the URL shape does not reveal the type; the caller resolves it instead. */
  contentType: ContentType | null;
}

const CONTENT_ID_PATTERN = /^\d+$/;

/**
 * URL shapes Confluence Cloud produces:
 *   /wiki/spaces/KEY/pages/123456/Page+Title
 *   /wiki/spaces/KEY/blog/2026/01/02/123456/Post+Title
 *   /wiki/spaces/KEY/pages/edit-v2/123456
 *   /wiki/pages/viewpage.action?pageId=123456
 *   /wiki/spaces/KEY/overview?pageId=123456
 */
const PAGE_PATH_PATTERN = /\/pages\/(?:edit-v2\/)?(\d+)(?:\/|$|\?|#)/;
const BLOG_PATH_PATTERN = /\/blog\/(?:\d{4}\/\d{1,2}\/\d{1,2}\/)?(\d+)(?:\/|$|\?|#)/;
const PAGE_ID_QUERY_PATTERN = /[?&]pageId=(\d+)(?:&|$|#)/;

/**
 * Returns the content the pasted text points at, or `null` when it is ordinary search text.
 *
 * Tiny links (`/wiki/x/ABC123`) are deliberately *not* handled: the id is an opaque hash that
 * only Confluence can expand, so there is nothing to extract locally. They fall through to a
 * normal search.
 */
export const parseContentLink = (input: string): ParsedContentLink | null => {
  const value = input.trim();
  if (!value) {
    return null;
  }

  // A bare id, which is what users paste when copying from a URL by hand.
  if (CONTENT_ID_PATTERN.test(value)) {
    return { contentId: value, contentType: null };
  }

  // Anything without a slash is search text, not a link. Checking this first keeps the regexes
  // from matching stray fragments of a sentence.
  if (!value.includes('/')) {
    return null;
  }

  const blogMatch = BLOG_PATH_PATTERN.exec(value);
  if (blogMatch?.[1]) {
    return { contentId: blogMatch[1], contentType: 'blogpost' };
  }

  const pageMatch = PAGE_PATH_PATTERN.exec(value);
  if (pageMatch?.[1]) {
    return { contentId: pageMatch[1], contentType: 'page' };
  }

  // `viewpage.action?pageId=` is type-agnostic despite the name, so the type stays unresolved.
  const queryMatch = PAGE_ID_QUERY_PATTERN.exec(value);
  if (queryMatch?.[1]) {
    return { contentId: queryMatch[1], contentType: null };
  }

  return null;
};

export const toResolvedContentType = (contentType: ContentType | null): ContentType => {
  return contentType ?? DEFAULT_CONTENT_TYPE;
};
