/**
 * Presentation helpers for Confluence content types.
 *
 * Mirrors the `linkStatus.ts` / `status.ts` split: the set of types and their labels come from
 * the shared module so the backend and the UI cannot disagree, and this file adds only the
 * visual concern - which icon represents each type.
 *
 * `AtlassianIcon` is used rather than the generic `Icon` because it ships the brand-coloured
 * Confluence object glyphs (a blue page, an orange blog post), which is what users already
 * recognise from Confluence search and the content tree. It also sets the colour automatically.
 */
import {
  CONTENT_TYPES,
  getContentTypeLabel,
  isContentType,
  toContentType,
  type ContentType
} from '../../shared/contentType';

export type { ContentType };
export { CONTENT_TYPES, getContentTypeLabel, isContentType, toContentType };

/** Glyph names come from `AtlassianIconType` in @forge/react. */
const CONTENT_TYPE_ICON_GLYPHS = {
  page: 'page',
  blogpost: 'blog'
} as const;

export const getContentTypeIconGlyph = (contentType: ContentType) => {
  return CONTENT_TYPE_ICON_GLYPHS[contentType];
};
