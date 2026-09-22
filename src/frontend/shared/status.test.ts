import { describe, expect, it } from 'vitest';
import {
  getStatusIconColor,
  getStatusIconGlyph,
  getStatusLabel,
  getValidTransitions,
  isLinkStatus
} from './status';

describe('status helpers', () => {
  it('recognizes valid statuses', () => {
    expect(isLinkStatus('not_started')).toBe(true);
    expect(isLinkStatus('needs_rework')).toBe(true);
    expect(isLinkStatus('done')).toBe(true);
    expect(isLinkStatus('invalid')).toBe(false);
  });

  it('returns deterministic labels and icons', () => {
    expect(getStatusLabel('ongoing_work')).toBe('Ongoing work');
    expect(getStatusIconGlyph('needs_review')).toBe('status-success');
    expect(getStatusIconGlyph('needs_rework')).toBe('problem');
    expect(getStatusIconColor('needs_rework')).toBe('color.icon.danger');
    expect(getStatusIconColor('done')).toBe('color.icon.brand');
  });

  it('exposes the workflow transitions from the shared state machine', () => {
    expect(getValidTransitions('not_started')).toEqual(['ongoing_work']);
    expect(getValidTransitions('needs_review')).toEqual(['needs_rework', 'done']);
    expect(getValidTransitions('done')).toEqual([]);
  });
});
