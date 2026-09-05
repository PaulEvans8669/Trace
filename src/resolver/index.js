import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { sql } from '@forge/sql';

const resolver = new Resolver();

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Generate a UUID-like string for database IDs.
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Execute a Forge SQL prepared statement with positional parameters.
 */
async function executeSql(query, params = []) {
  const statement = sql.prepare(query);
  const boundStatement = params.length > 0 ? statement.bindParams(...params) : statement;
  return boundStatement.execute();
}

// ============================================================================
// RESOLVER DEFINITIONS FOR CONTENT-TICKET LINKS
// ============================================================================

resolver.define('linkContentToTicket', async ({ payload }) => {
  const { contentId, contentType = 'page', issueKey } = payload;
  
  if (!contentId || !issueKey) {
    throw new Error('contentId and issueKey are required');
  }

  try {
    const now = Date.now();

    const existingResult = await executeSql(
      `SELECT id, unlinked_at
      FROM content_ticket_links
      WHERE content_id = ? AND jira_issue_key = ?`,
      [contentId, issueKey]
    );
    const existingRows = Array.isArray(existingResult && existingResult.rows) ? existingResult.rows : [];
    const existingRow = existingRows.length > 0 ? existingRows[0] : null;

    if (existingRow) {
      if (existingRow.unlinked_at !== null && existingRow.unlinked_at !== undefined) {
        await executeSql(
          `UPDATE content_ticket_links
          SET content_type = ?, link_status = 'not_started', linked_at = ?, updated_at = ?, unlinked_at = NULL
          WHERE id = ?`,
          [contentType, now, now, existingRow.id]
        );

        return {
          success: true,
          linkId: existingRow.id,
          message: `Content relinked to issue ${issueKey}`
        };
      }

      return {
        success: true,
        linkId: existingRow.id,
        message: `Content already linked to issue ${issueKey}`
      };
    }

    const id = generateId();

    // Insert into database
    await executeSql(
      `INSERT INTO content_ticket_links (
        id, content_id, content_type, jira_issue_key, link_status, linked_at, updated_at
      ) VALUES (?, ?, ?, ?, 'not_started', ?, ?)`,
      [id, contentId, contentType, issueKey, now, now]
    );

    return {
      success: true,
      linkId: id,
      message: `Content linked to issue ${issueKey}`
    };
  } catch (error) {
    if (
      (error && error.message && error.message.includes('UNIQUE constraint failed')) ||
      (error && error.debug && error.debug.code === 'ER_DUP_ENTRY')
    ) {
      const retryResult = await executeSql(
        `SELECT id, unlinked_at
        FROM content_ticket_links
        WHERE content_id = ? AND jira_issue_key = ?`,
        [contentId, issueKey]
      );
      const retryRows = Array.isArray(retryResult && retryResult.rows) ? retryResult.rows : [];
      const retryRow = retryRows.length > 0 ? retryRows[0] : null;

      if (retryRow) {
        return {
          success: true,
          linkId: retryRow.id,
          message: retryRow.unlinked_at !== null && retryRow.unlinked_at !== undefined
            ? `Content relinked to issue ${issueKey}`
            : `Content already linked to issue ${issueKey}`
        };
      }
    }
    throw error;
  }
});

resolver.define('unlinkContentFromTicket', async ({ payload }) => {
  const { contentId, issueKey } = payload;
  
  if (!contentId || !issueKey) {
    throw new Error('contentId and issueKey are required');
  }

  try {
    // Soft delete: mark unlinked_at
    const now = Date.now();
    await executeSql(
      `UPDATE content_ticket_links
      SET unlinked_at = ?
      WHERE content_id = ? AND jira_issue_key = ? AND unlinked_at IS NULL`,
      [now, contentId, issueKey]
    );

    return {
      success: true,
      message: `Content unlinked from issue ${issueKey}`
    };
  } catch (error) {
    throw error;
  }
});

resolver.define('updateLinkStatus', async ({ payload }) => {
  const { contentId, issueKey, newStatus } = payload;
  
  if (!contentId || !issueKey || !newStatus) {
    throw new Error('contentId, issueKey, and newStatus are required');
  }

  const validStatuses = ['not_started', 'ongoing_work', 'needs_review', 'done'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  try {
    const now = Date.now();
    
    // Update status in database
    await executeSql(
      `UPDATE content_ticket_links
      SET link_status = ?, updated_at = ?
      WHERE content_id = ? AND jira_issue_key = ? AND unlinked_at IS NULL`,
      [newStatus, now, contentId, issueKey]
    );

    return {
      success: true,
      message: `Link status updated to ${newStatus}`
    };
  } catch (error) {
    throw error;
  }
});

resolver.define('getLinksForContent', async ({ payload }) => {
  const { contentId } = payload;
  
  if (!contentId) {
    throw new Error('contentId is required');
  }

  try {
    // Fetch all active links (unlinked_at IS NULL) for this content
    const queryResult = await executeSql(
      `SELECT id, jira_issue_key, link_status, linked_at, updated_at
      FROM content_ticket_links
      WHERE content_id = ? AND unlinked_at IS NULL
      ORDER BY updated_at DESC`,
      [contentId]
    );
    const rows = Array.isArray(queryResult && queryResult.rows) ? queryResult.rows : [];

    return {
      success: true,
      links: rows.map(row => ({
        id: row.id,
        issueKey: row.jira_issue_key,
        status: row.link_status,
        linkedAt: row.linked_at,
        updatedAt: row.updated_at
      }))
    };
  } catch (error) {
    throw error;
  }
});

resolver.define('getLinksForTicket', async ({ payload }) => {
  const { issueKey } = payload;
  
  if (!issueKey) {
    throw new Error('issueKey is required');
  }

  try {
    // Fetch all active links for this issue
    const queryResult = await executeSql(
      `SELECT id, content_id, content_type, link_status, linked_at, updated_at
      FROM content_ticket_links
      WHERE jira_issue_key = ? AND unlinked_at IS NULL
      ORDER BY updated_at DESC`,
      [issueKey]
    );
    const rows = Array.isArray(queryResult && queryResult.rows) ? queryResult.rows : [];

    return {
      success: true,
      links: rows.map(row => ({
        id: row.id,
        contentId: row.content_id,
        contentType: row.content_type,
        status: row.link_status,
        linkedAt: row.linked_at,
        updatedAt: row.updated_at
      }))
    };
  } catch (error) {
    throw error;
  }
});

// ============================================================================
// EXISTING RESOLVERS (CONFLUENCE SEARCH)
// ============================================================================

const buildWebUrl = (entity) => {
  const relativeWebUrl = (entity && entity._links && entity._links.webui) || '';
  const baseUrl = (entity && entity._links && entity._links.base) || '';

  if (!relativeWebUrl) {
    return '';
  }

  if (relativeWebUrl.startsWith('http://') || relativeWebUrl.startsWith('https://')) {
    return relativeWebUrl;
  }

  if (baseUrl) {
    return `${baseUrl}${relativeWebUrl}`;
  }

  if (relativeWebUrl.startsWith('/spaces/')) {
    return `/wiki${relativeWebUrl}`;
  }

  return relativeWebUrl;
};

resolver.define('searchConfluencePages', async ({ payload }) => {
  const query = payload && typeof payload.query === 'string' ? payload.query.trim() : '';

  if (query.length < 2) {
    return { results: [] };
  }

  // We escape user input before embedding it into CQL so special characters
  // do not break the query syntax.
  const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cqlQuery = `type = page AND title ~ "${escapedQuery}" ORDER BY lastmodified DESC`;
  const queryParams = new URLSearchParams({
    cql: cqlQuery,
    expand: 'content.space',
    limit: '50'
  });
  const cqlParam = queryParams.get('cql') || '';
  const expandParam = queryParams.get('expand') || 'content.space';
  const limitParam = queryParams.get('limit') || '50';

  const response = await api.asUser().requestConfluence(
    route`/wiki/rest/api/search?cql=${cqlParam}&expand=${expandParam}&limit=${limitParam}`
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Confluence search failed: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  const results = data && Array.isArray(data.results) ? data.results : [];

  const normalizedResults = results.map((page) => {
    const resultSpace = page.space || {};
    const content = page.content || {};
    const contentSpace = content.space || {};
    const fallbackRelativeUrl = page.url || '';
    const directPageId = page.id || '';
    const nestedPageId = content.id || '';
    const resolvedPageId = directPageId || nestedPageId;
    const title = page.title || content.title || 'Untitled page';
    const contentType = page.type || content.type || 'page';
    const webUrl = buildWebUrl(page) || buildWebUrl(content) || fallbackRelativeUrl;

    return {
      id: String(resolvedPageId),
      title,
      spaceKey: resultSpace.key || contentSpace.key || '',
      spaceName: resultSpace.name || contentSpace.name || '',
      contentType,
      webUrl,
      contentStatus: page.status || content.status || null,
      updatedAt:
        page.lastModified ||
        (page.history && page.history.lastUpdated && page.history.lastUpdated.when) ||
        (content.history && content.history.lastUpdated && content.history.lastUpdated.when) ||
        null
    };
  }).filter((page) => page.id);

  return {
    results: normalizedResults
  };
});

resolver.define('getConfluencePageState', async ({ payload }) => {
  const pageId = payload && typeof payload.pageId === 'string' ? payload.pageId.trim() : '';
  const fallbackStatus = payload && typeof payload.fallbackStatus === 'string' ? payload.fallbackStatus : null;

  if (!pageId) {
    return { stateLabel: 'null' };
  }

  const response = await api.asUser().requestConfluence(
    route`/wiki/rest/api/content/${pageId}/state`
  );

  if (response.ok) {
    const stateData = await response.json();
    const stateName =
      stateData &&
      stateData.contentState &&
      stateData.contentState.name
        ? String(stateData.contentState.name).trim()
        : '';

    if (stateName) {
      return { stateLabel: stateName };
    }
  }

  // Some pages may not expose an explicit content state. In this case we map
  // from standard Confluence status fields so the UI still reflects page state.
  if (fallbackStatus === 'draft') {
    return { stateLabel: 'Brouillon' };
  }

  if (fallbackStatus === 'current') {
    return { stateLabel: 'null' };
  }

  return { stateLabel: 'null' };
});

// Fetch Confluence page details by content ID (used by Jira issue context to enrich linked pages)
resolver.define('getConfluencePageDetails', async ({ payload }) => {
  const contentId = payload && typeof payload.contentId === 'string' ? payload.contentId.trim() : '';

  if (!contentId) {
    return { success: false, error: 'No content ID provided' };
  }

  try {
    const cqlQuery = `id=${contentId}`;
    const queryParams = new URLSearchParams({
      cql: cqlQuery,
      expand: 'content.space',
      limit: '1'
    });
    const cqlParam = queryParams.get('cql') || '';
    const expandParam = queryParams.get('expand') || 'content.space';
    const limitParam = queryParams.get('limit') || '1';

    const response = await api.asUser().requestConfluence(
      route`/wiki/rest/api/search?cql=${cqlParam}&expand=${expandParam}&limit=${limitParam}`
    );

    if (!response.ok) {
      return { success: false, error: `Could not fetch page: ${response.status}` };
    }

    const data = await response.json();
    const results = data && Array.isArray(data.results) ? data.results : [];
    const page = results.length > 0 ? results[0] : null;

    if (!page) {
      return { success: false, error: 'Page not found' };
    }

    const content = page.content || {};
    const space = page.space || content.space || {};
    const title = page.title || content.title || 'Untitled page';
    const webUrl = buildWebUrl(page) || buildWebUrl(content) || `/wiki/pages/viewpage.action?pageId=${contentId}`;

    return {
      success: true,
      page: {
        id: String(page.id || content.id || contentId),
        title,
        spaceKey: space.key || '',
        spaceName: space.name || '',
        webUrl,
        contentType: page.type || content.type || 'page'
      }
    };
  } catch (err) {
    console.error(`Error fetching page ${contentId}:`, err);
    return { success: false, error: err.message };
  }
});

export const handler = resolver.getDefinitions();
