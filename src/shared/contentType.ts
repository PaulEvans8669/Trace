/**
 * The Confluence content types this app can link to.
 *
 * Scope is deliberately narrow: a type earns a place here only if Confluence can render the
 * link *back*. `confluence:contentBylineItem` - the module that shows "which Jira issues
 * reference this content" - only renders on pages and blog posts, so anything else (whiteboards,
 * databases, attachments, ...) would be a one-way link the user could never discover from the
 * Confluence side.
 *
 * This module lives in `shared/` for the same reason `linkStatus.ts` does: the resolver and the
 * UI Kit frontend must agree on the exact set of values, and re-declaring them would let the two
 * drift apart silently.
 */

export const CONTENT_TYPES = ['page', 'blogpost'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** The type stored against a link when Confluence tells us nothing useful. */
export const DEFAULT_CONTENT_TYPE: ContentType = 'page';

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  page: 'Page',
  blogpost: 'Blog post'
};

export const isContentType = (value: unknown): value is ContentType => {
  return typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value);
};

/**
 * Coerces whatever Confluence (or an old database row) reports into a supported type.
 *
 * Unknown values fall back to `page` rather than throwing: a link that was created before a
 * type was recognised should still render, just with the generic icon.
 */
export const toContentType = (value: unknown): ContentType => {
  return isContentType(value) ? value : DEFAULT_CONTENT_TYPE;
};

export const getContentTypeLabel = (contentType: ContentType): string => {
  return CONTENT_TYPE_LABELS[contentType];
};
