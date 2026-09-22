import { randomUUID } from 'crypto';
import type {
  BylineView,
  ContentPayload,
  IssuePanelView,
  LinkContentPayload,
  LinkTransitionHistoryPayload,
  LinkTransitionResponse,
  TicketPayload,
  UnlinkContentPayload,
  UpdateLinkStatusPayload
} from '../types/contracts';
import { isLinkStatus, isValidTransition, type LinkStatus } from '../../shared/linkStatus';
import { conflictError, invalidTransitionError, notFoundError, validationError } from '../../shared/appError';
import {
  findActiveByContent,
  findActiveByIssue,
  findByContentAndIssue,
  findTransitionHistoryByContentAndIssue,
  insertLink,
  insertTransitionHistory,
  relink,
  revertStatusTransition,
  softUnlink,
  softUnlinkAllByContent,
  softUnlinkAllByIssue,
  updateStatusWithTransition
} from '../repositories/contentTicketLinksRepository';
import {
  getContentVersion,
  getPagesByIds,
  isContentVisible,
  isValidContentId,
  type ConfluencePageDetails
} from '../clients/confluenceClient';
import { toContentType, type ContentType } from '../../shared/contentType';
import { getIssuesByKeys, isIssueVisible, isValidIssueKey } from '../clients/jiraClient';

/**
 * Business rules for content <-> ticket links.
 *
 * Three responsibilities worth calling out:
 *
 *  1. It enforces the workflow state machine, so the backend never trusts the UI to have
 *     offered only legal transitions.
 *
 *  2. It filters stored rows against what the calling user is allowed to see. The link table is
 *     app-scoped storage with no built-in permissions, so without this a user could enumerate
 *     issue keys attached to pages they cannot read (and vice versa).
 *
 *  3. The two read paths return fully rendered view models rather than raw rows. Because
 *     authorization already requires fetching the page and the issues, returning that data is
 *     free - and it means each panel loads in a single round trip.
 */

interface DuplicateError {
  message?: string;
  debug?: {
    code?: string;
  };
}

/** Collision-free ids, unlike the previous timestamp + Math.random() scheme. */
const generateId = (): string => randomUUID();

/**
 * The unique key on (content_id, jira_issue_key) means two simultaneous link attempts race,
 * and the loser sees a duplicate-key error. That is recoverable, so we detect it specifically.
 */
const isDuplicateError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const duplicateError = error as DuplicateError;
  const message = typeof duplicateError.message === 'string' ? duplicateError.message : '';
  const debugCode = duplicateError.debug?.code;
  return message.includes('UNIQUE constraint failed') || debugCode === 'ER_DUP_ENTRY';
};

const requireContentId = (contentId: unknown): string => {
  const value = typeof contentId === 'string' ? contentId.trim() : '';
  if (!value) {
    throw validationError('contentId is required');
  }
  if (!isValidContentId(value)) {
    throw validationError('contentId must be a numeric Confluence content id');
  }
  return value;
};

const requireIssueKey = (issueKey: unknown): string => {
  const value = typeof issueKey === 'string' ? issueKey.trim() : '';
  if (!value) {
    throw validationError('issueKey is required');
  }
  if (!isValidIssueKey(value)) {
    throw validationError('issueKey must look like PROJ-123');
  }
  return value;
};

/**
 * Permission probes for the write paths, which need a yes/no answer rather than page or issue
 * data. Both underlying calls run `asUser()`, so the product itself decides the answer.
 *
 * The content type has to be supplied because Confluence serves each type from its own v2
 * collection - probing a blog post through `/pages/{id}` returns 404 and would report perfectly
 * visible content as inaccessible.
 */
const assertContentVisible = async (contentId: string, contentType: ContentType): Promise<void> => {
  if (!(await isContentVisible(contentId, contentType))) {
    throw notFoundError('Content not found or not accessible');
  }
};

const assertIssueVisible = async (issueKey: string): Promise<void> => {
  if (!(await isIssueVisible(issueKey))) {
    throw notFoundError('Issue not found or not accessible');
  }
};

/**
 * Fetches a page for the read paths, where the details are needed as well as the yes/no answer.
 * A page the user cannot read simply does not come back, so this authorises and enriches at once.
 */
const requireVisiblePage = async (contentId: string): Promise<ConfluencePageDetails> => {
  const pages = await getPagesByIds([contentId]);
  const page = pages.get(contentId);
  if (!page) {
    throw notFoundError('Content not found or not accessible');
  }
  return page;
};

/**
 * Every link starts life with a `not_started` history entry so the history view always has a
 * baseline, stamped with the page version at the moment of linking.
 */
const insertInitialLinkHistory = async (
  linkId: string,
  contentId: string,
  contentType: ContentType,
  issueKey: string,
  linkedAt: number,
  accountId: string | null
): Promise<void> => {
  const initialVersion = await getContentVersion(contentId, contentType);
  await insertTransitionHistory(
    generateId(),
    linkId,
    contentId,
    issueKey,
    'not_started',
    initialVersion,
    linkedAt,
    accountId
  );
};

/** Normalises the resolver `context.accountId`, which is absent for non-user invocations. */
const toAccountId = (contextAccountId?: string): string | null => {
  return typeof contextAccountId === 'string' && contextAccountId.trim().length > 0
    ? contextAccountId.trim()
    : null;
};

interface ServiceParams<TPayload> {
  payload: TPayload;
  contextAccountId?: string;
}

export const linkContentToTicket = async ({ payload, contextAccountId }: ServiceParams<LinkContentPayload>) => {
  const contentId = requireContentId(payload?.contentId);
  const issueKey = requireIssueKey(payload?.issueKey);
  const accountId = toAccountId(contextAccountId);

  // Check both sides before writing: linking is what grants visibility of the pair later on.
  // The Confluence side returns the content itself, because the type is taken from Confluence
  // rather than from the client - a caller should not get to label a page a blogpost.
  const [page] = await Promise.all([requireVisiblePage(contentId), assertIssueVisible(issueKey)]);

  // The last line of defence against linking a space overview. The picker already hides them and
  // the pasted-link resolver rejects them, but this is the only place a link is actually written,
  // and a link the user could never see from Confluence is worth refusing outright.
  if (page.isSpaceOverview) {
    throw validationError('A space overview cannot be linked, because it cannot display the link back to this issue');
  }

  const contentType = toContentType(page.contentType);

  const now = Date.now();
  const existingLink = await findByContentAndIssue(contentId, issueKey);

  if (existingLink) {
    if (existingLink.unlinkedAt === null) {
      return { linkId: existingLink.id, message: `Content already linked to issue ${issueKey}` };
    }

    await relink(existingLink.id, contentType, now);
    await insertInitialLinkHistory(existingLink.id, contentId, contentType, issueKey, now, accountId);
    return { linkId: existingLink.id, message: `Content relinked to issue ${issueKey}` };
  }

  const id = generateId();
  try {
    await insertLink(id, contentId, contentType, issueKey, now);
    await insertInitialLinkHistory(id, contentId, contentType, issueKey, now, accountId);
    return { linkId: id, message: `Content linked to issue ${issueKey}` };
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }

    // Another request created the row first. Re-read and converge on its id.
    const retryLink = await findByContentAndIssue(contentId, issueKey);
    if (!retryLink) {
      throw error;
    }

    if (retryLink.unlinkedAt !== null) {
      await relink(retryLink.id, contentType, now);
      await insertInitialLinkHistory(retryLink.id, contentId, contentType, issueKey, now, accountId);
      return { linkId: retryLink.id, message: `Content relinked to issue ${issueKey}` };
    }

    return { linkId: retryLink.id, message: `Content already linked to issue ${issueKey}` };
  }
};

export const unlinkContentFromTicket = async ({ payload }: ServiceParams<UnlinkContentPayload>) => {
  const contentId = requireContentId(payload?.contentId);
  const issueKey = requireIssueKey(payload?.issueKey);

  // The stored type tells us which v2 collection to probe. Reading the row first also means an
  // already-unlinked pair costs no Confluence call at all.
  const existingLink = await findByContentAndIssue(contentId, issueKey);
  if (!existingLink || existingLink.unlinkedAt !== null) {
    return { message: `No active link between this content and ${issueKey}` };
  }

  await assertContentVisible(contentId, toContentType(existingLink.contentType));

  const unlinkedCount = await softUnlink(contentId, issueKey, Date.now());
  if (unlinkedCount === 0) {
    return { message: `No active link between this content and ${issueKey}` };
  }

  return { message: `Content unlinked from issue ${issueKey}` };
};

export const updateLinkStatus = async ({ payload, contextAccountId }: ServiceParams<UpdateLinkStatusPayload>) => {
  const contentId = requireContentId(payload?.contentId);
  const issueKey = requireIssueKey(payload?.issueKey);
  const requestedStatus = typeof payload?.newStatus === 'string' ? payload.newStatus : '';

  if (!requestedStatus) {
    throw validationError('newStatus is required');
  }
  if (!isLinkStatus(requestedStatus)) {
    throw validationError(`Invalid status: ${requestedStatus}`);
  }
  const resolvedStatus: LinkStatus = requestedStatus;

  // The row is read before the permission probe, not after: its `content_type` is what tells us
  // which v2 collection to probe. Probing a blog post as a page would 404 and reject the
  // transition on perfectly visible content.
  const existingLink = await findByContentAndIssue(contentId, issueKey);
  if (!existingLink || existingLink.unlinkedAt !== null) {
    throw notFoundError('Cannot transition an unlinked or missing content-ticket link');
  }

  const contentType = toContentType(existingLink.contentType);
  await assertContentVisible(contentId, contentType);

  // The state machine is enforced here, not only in the UI, so a hand-crafted invoke cannot
  // jump straight from not_started to done.
  if (!isValidTransition(existingLink.status, resolvedStatus)) {
    throw invalidTransitionError(`Invalid transition from ${existingLink.status} to ${resolvedStatus}`);
  }

  const transitionTimestamp = Date.now();
  const confluenceVersion = await getContentVersion(contentId, contentType);
  const transitionedByAccountId = toAccountId(contextAccountId);

  const updatedCount = await updateStatusWithTransition(
    contentId,
    issueKey,
    existingLink.status,
    resolvedStatus,
    confluenceVersion,
    transitionTimestamp
  );

  // Zero rows means the status changed underneath us between the read and the write.
  if (updatedCount === 0) {
    throw conflictError('This link was updated by someone else. Refresh the panel and try the transition again.');
  }

  // Forge SQL exposes no transaction API, so the status update and its history row cannot be
  // committed together. The invariant we care about is "a status change always has an audit
  // entry", so if the history write fails we undo the status change rather than leave a silent
  // gap in the trail. The revert is guarded on the status we just wrote, so a concurrent
  // transition that slipped in between is never clobbered.
  try {
    await insertTransitionHistory(
      generateId(),
      existingLink.id,
      contentId,
      issueKey,
      resolvedStatus,
      confluenceVersion,
      transitionTimestamp,
      transitionedByAccountId
    );
  } catch (historyError) {
    console.error('Transition history write failed; reverting the status update', historyError);
    await revertStatusTransition(
      contentId,
      issueKey,
      resolvedStatus,
      existingLink.status,
      existingLink.transitionVersion,
      existingLink.transitionAt,
      existingLink.updatedAt
    ).catch((revertError) => {
      // Nothing left to try. Log loudly - this is the one path that can leave the audit trail
      // incomplete, and it needs to be greppable.
      console.error('Status revert failed; link status and history are inconsistent', revertError);
    });

    throw historyError;
  }

  const transition: LinkTransitionResponse = {
    status: resolvedStatus,
    confluenceVersion,
    transitionedAt: transitionTimestamp,
    transitionedByAccountId
  };

  return {
    message: `Link status updated to ${resolvedStatus}`,
    transition
  };
};

export const getLinkTransitionHistory = async ({ payload }: ServiceParams<LinkTransitionHistoryPayload>) => {
  const contentId = requireContentId(payload?.contentId);
  const issueKey = requireIssueKey(payload?.issueKey);

  // As in the other write paths, the stored type decides which v2 collection to probe.
  const existingLink = await findByContentAndIssue(contentId, issueKey);
  if (!existingLink) {
    throw notFoundError('Content not found or not accessible');
  }

  await assertContentVisible(contentId, toContentType(existingLink.contentType));

  const history = await findTransitionHistoryByContentAndIssue(contentId, issueKey);

  return {
    history: history.map((entry) => ({
      id: entry.id,
      contentId: entry.contentId,
      issueKey: entry.issueKey,
      status: entry.status,
      transitionVersion: entry.transitionVersion,
      transitionedAt: entry.transitionedAt,
      transitionedByAccountId: entry.transitionedByAccountId
    }))
  };
};

/**
 * Everything the Confluence byline panel renders, in one call.
 *
 * The single Jira lookup doubles as the authorization filter: issues absent from the response
 * are ones the caller may not see, so the corresponding links are dropped rather than leaking
 * an issue key.
 */
export const getBylineView = async ({ payload }: ServiceParams<ContentPayload>): Promise<BylineView> => {
  const contentId = requireContentId(payload?.contentId);

  const page = await requireVisiblePage(contentId);
  const { links, truncated } = await findActiveByContent(contentId);

  const issues = await getIssuesByKeys(links.map((link) => link.issueKey));
  const issuesByKey = new Map(issues.map((issue) => [issue.issueKey, issue]));

  return {
    page: {
      id: page.id,
      title: page.title,
      spaceKey: page.spaceKey,
      spaceName: page.spaceName,
      webUrl: page.webUrl
    },
    truncated,
    links: links.flatMap((link) => {
      const issue = issuesByKey.get(link.issueKey);
      if (!issue) {
        return [];
      }

      return [
        {
          id: link.id,
          contentId: link.contentId,
          issueKey: link.issueKey,
          status: link.status,
          linkedAt: link.linkedAt,
          updatedAt: link.updatedAt,
          transitionVersion: link.transitionVersion,
          transitionAt: link.transitionAt,
          summary: issue.summary,
          issueTypeName: issue.issueTypeName,
          issueTypeIconUrl: issue.issueTypeIconUrl
        }
      ];
    })
  };
};

/**
 * Everything the Jira issue panel renders, in one call. Mirror image of `getBylineView`: the
 * batched Confluence lookup both authorises and supplies the titles, spaces and URLs.
 */
export const getIssuePanelView = async ({ payload }: ServiceParams<TicketPayload>): Promise<IssuePanelView> => {
  const issueKey = requireIssueKey(payload?.issueKey);

  await assertIssueVisible(issueKey);
  const { links, truncated } = await findActiveByIssue(issueKey);

  const pagesById = await getPagesByIds(links.map((link) => link.contentId));

  return {
    truncated,
    links: links.flatMap((link) => {
      const page = pagesById.get(link.contentId);
      if (!page) {
        return [];
      }

      return [
        {
          id: link.id,
          contentId: link.contentId,
          contentType: link.contentType,
          status: link.status,
          linkedAt: link.linkedAt,
          updatedAt: link.updatedAt,
          title: page.title,
          spaceKey: page.spaceKey,
          spaceName: page.spaceName,
          webUrl: page.webUrl
        }
      ];
    })
  };
};

/**
 * Cleanup handlers for the product triggers declared in `manifest.yml`.
 *
 * When a page or issue is deleted the link rows would otherwise sit in the table forever: the
 * permission filter hides them from every panel, but they are still stored and still re-queried
 * on each load. Soft-unlinking (rather than deleting) keeps the transition history intact.
 *
 * These run without a user context, so they deliberately skip the permission probes - the
 * product has already told us the entity is gone.
 */
export const handleContentDeleted = async (contentId: string): Promise<number> => {
  if (!contentId || !isValidContentId(contentId)) {
    return 0;
  }
  return softUnlinkAllByContent(contentId, Date.now());
};

export const handleIssueDeleted = async (issueKey: string): Promise<number> => {
  if (!issueKey || !isValidIssueKey(issueKey)) {
    return 0;
  }
  return softUnlinkAllByIssue(issueKey, Date.now());
};
