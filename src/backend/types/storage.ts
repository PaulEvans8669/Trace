import type { LinkStatus } from './contracts';

export interface ContentTicketLinkRecord {
  id: string;
  contentId: string;
  contentType: string;
  issueKey: string;
  status: LinkStatus;
  linkedAt: number;
  updatedAt: number;
  transitionVersion: number | null;
  transitionAt: number | null;
  unlinkedAt: number | null;
}

export interface ContentTicketLinkTransitionRecord {
  id: string;
  linkId: string;
  contentId: string;
  issueKey: string;
  status: LinkStatus;
  transitionVersion: number;
  transitionedAt: number;
  /** `null` when the transition was recorded without an identifiable user. */
  transitionedByAccountId: string | null;
}
