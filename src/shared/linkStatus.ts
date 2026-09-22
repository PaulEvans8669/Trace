/**
 * Single source of truth for the documentation workflow.
 *
 * This module is deliberately dependency-free (no `@forge/api`, no `@forge/bridge`, no React)
 * so that it can be imported by BOTH the backend resolver bundle and the UI Kit frontend
 * bundle. Anything added here must stay free of platform imports, otherwise one of the two
 * bundles will break at build time.
 */

/** Every state a content <-> ticket link can be in. Mirrors the SQL `link_status` ENUM. */
export type LinkStatus = 'not_started' | 'ongoing_work' | 'needs_review' | 'needs_rework' | 'done';

/**
 * The allowed state machine.
 *
 * A link always starts at `not_started` and can only move along these edges. Keeping this map
 * here (rather than in the frontend) means the resolver can enforce it too, so a hand-crafted
 * `invoke` cannot skip straight from `not_started` to `done`.
 */
const VALID_STATUS_TRANSITIONS: Record<LinkStatus, readonly LinkStatus[]> = {
  not_started: ['ongoing_work'],
  ongoing_work: ['needs_review', 'done'],
  needs_review: ['needs_rework', 'done'],
  needs_rework: ['ongoing_work'],
  done: []
};

/** All statuses, derived from the transition map so the two can never drift apart. */
export const VALID_LINK_STATUSES = Object.keys(VALID_STATUS_TRANSITIONS) as LinkStatus[];

/** The state every newly created (or relinked) link starts in. */
export const INITIAL_LINK_STATUS: LinkStatus = 'not_started';

/** Narrows an arbitrary string coming off the wire into a `LinkStatus`. */
export const isLinkStatus = (status: string): status is LinkStatus => {
  return Object.prototype.hasOwnProperty.call(VALID_STATUS_TRANSITIONS, status);
};

/** Returns the statuses a link may move to from `status`. Used to build the transition menu. */
export const getValidTransitions = (status: LinkStatus): LinkStatus[] => {
  return [...VALID_STATUS_TRANSITIONS[status]];
};

/** True when moving `from -> to` is an edge in the state machine. */
export const isValidTransition = (from: LinkStatus, to: LinkStatus): boolean => {
  return VALID_STATUS_TRANSITIONS[from].includes(to);
};
