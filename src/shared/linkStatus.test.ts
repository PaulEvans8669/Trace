import { describe, expect, it } from 'vitest';
import {
  INITIAL_LINK_STATUS,
  VALID_LINK_STATUSES,
  getValidTransitions,
  isLinkStatus,
  isValidTransition,
  type LinkStatus
} from './linkStatus';

describe('link status state machine', () => {
  it('narrows only known statuses', () => {
    expect(isLinkStatus('not_started')).toBe(true);
    expect(isLinkStatus('needs_rework')).toBe(true);
    expect(isLinkStatus('invalid')).toBe(false);
    expect(isLinkStatus('toString')).toBe(false);
  });

  it('lists every status exactly once', () => {
    expect([...VALID_LINK_STATUSES].sort()).toEqual(
      ['done', 'needs_review', 'needs_rework', 'not_started', 'ongoing_work'].sort()
    );
  });

  it('starts links at not_started', () => {
    expect(INITIAL_LINK_STATUS).toBe('not_started');
  });

  it('only allows edges declared in the transition map', () => {
    expect(isValidTransition('not_started', 'ongoing_work')).toBe(true);
    expect(isValidTransition('not_started', 'done')).toBe(false);
    expect(isValidTransition('needs_review', 'needs_rework')).toBe(true);
    expect(isValidTransition('done', 'ongoing_work')).toBe(false);
  });

  it('never returns a transition that points at an unknown status', () => {
    VALID_LINK_STATUSES.forEach((status: LinkStatus) => {
      getValidTransitions(status).forEach((target) => {
        expect(VALID_LINK_STATUSES).toContain(target);
      });
    });
  });

  it('returns a defensive copy so callers cannot mutate the state machine', () => {
    const transitions = getValidTransitions('ongoing_work');
    transitions.push('not_started');
    expect(getValidTransitions('ongoing_work')).toEqual(['needs_review', 'done']);
  });

  it('makes done a terminal state', () => {
    expect(getValidTransitions('done')).toEqual([]);
  });
});
