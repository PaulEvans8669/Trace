import { AtlassianIcon, Tooltip } from '@forge/react';
import { getContentTypeIconGlyph, getContentTypeLabel, type ContentType } from '../contentType';

/**
 * The icon for a Confluence content type, used by both the picker and the linked-resources
 * table so a page always looks the same wherever it appears.
 *
 * The type is conveyed by the glyph alone - there is no text label on either surface - so the
 * tooltip lives here rather than at each call site. That way every surface that shows the icon
 * explains it, and none of them can forget to.
 *
 * The label doubles as the accessible name, so screen readers announce "Page" / "Blog post"
 * rather than an unlabelled graphic.
 */

interface ContentTypeIconProps {
  contentType: ContentType;
  size?: 'small' | 'medium';
}

export const ContentTypeIcon = ({ contentType, size = 'medium' }: ContentTypeIconProps) => {
  const label = getContentTypeLabel(contentType);

  return (
    <Tooltip content={label}>
      <AtlassianIcon glyph={getContentTypeIconGlyph(contentType)} label={label} size={size} />
    </Tooltip>
  );
};
