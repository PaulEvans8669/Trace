/**
 * Presentation helpers for link statuses.
 *
 * The workflow rules (which statuses exist, and which transitions are legal) come from the
 * shared module so the backend enforces exactly what the UI offers. This file only adds the
 * purely visual concerns: labels, icon glyphs and icon colours.
 */
import { getValidTransitions, isLinkStatus, type LinkStatus } from '../../shared/linkStatus';

export type { LinkStatus };
export { getValidTransitions, isLinkStatus };

const STATUS_ICON_GLYPHS = {
  not_started: 'task-to-do',
  ongoing_work: 'task-in-progress',
  needs_review: 'status-success',
  needs_rework: 'problem',
  done: 'status-verified'
} as const;

const STATUS_ICON_COLORS = {
  not_started: 'color.icon.subtle',
  ongoing_work: 'color.icon.warning',
  needs_review: 'color.icon.success',
  needs_rework: 'color.icon.danger',
  done: 'color.icon.brand'
} as const;

const STATUS_LABELS: Record<LinkStatus, string> = {
  not_started: 'Not started',
  ongoing_work: 'Ongoing work',
  needs_review: 'Needs review',
  needs_rework: 'Needs rework',
  done: 'Done'
};

export const getStatusIconGlyph = (status: LinkStatus) => {
  return STATUS_ICON_GLYPHS[status];
};

export const getStatusIconColor = (status: LinkStatus) => {
  return STATUS_ICON_COLORS[status];
};

export const getStatusLabel = (status: LinkStatus): string => {
  return STATUS_LABELS[status];
};
