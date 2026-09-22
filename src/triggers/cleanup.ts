import { handleContentDeleted, handleIssueDeleted } from '../backend/services/linkService';

/**
 * Product trigger handlers that keep the link table tidy.
 *
 * Without these, deleting a Confluence page or a Jira issue leaves its link rows in storage
 * forever. The permission filter already hides them from every panel, so they are invisible -
 * but they are still stored, still counted against the read limit, and still re-queried on
 * every single panel load.
 *
 * These handlers soft-unlink the affected rows rather than deleting them, so the transition
 * history remains available for auditing. They run without a user context (no `accountId`),
 * which is why the service skips its usual permission probes here: the product has already
 * told us the entity no longer exists.
 *
 * Trigger handlers must never throw. Forge retries failures, and a permanently failing handler
 * would retry forever, so errors are logged and swallowed.
 */

/** The parts of a Forge product event we care about. Everything else is ignored. */
interface ProductEvent {
  content?: { id?: string | number };
  issue?: { key?: string };
}

const readContentId = (event: ProductEvent): string => {
  const id = event?.content?.id;
  return id === undefined || id === null ? '' : String(id);
};

export const onContentDeleted = async (event: ProductEvent): Promise<void> => {
  try {
    const contentId = readContentId(event);
    const unlinked = await handleContentDeleted(contentId);
    if (unlinked > 0) {
      console.log(`Soft-unlinked ${unlinked} link(s) for deleted content ${contentId}`);
    }
  } catch (error) {
    console.error('Failed to clean up links for deleted content', error);
  }
};

export const onIssueDeleted = async (event: ProductEvent): Promise<void> => {
  try {
    const issueKey = event?.issue?.key ? String(event.issue.key) : '';
    const unlinked = await handleIssueDeleted(issueKey);
    if (unlinked > 0) {
      console.log(`Soft-unlinked ${unlinked} link(s) for deleted issue ${issueKey}`);
    }
  } catch (error) {
    console.error('Failed to clean up links for deleted issue', error);
  }
};
