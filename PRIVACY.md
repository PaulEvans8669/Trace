# Privacy Policy for Trace

**Effective date:** 22 September 2026
**Last updated:** 22 September 2026
**App:** Trace — an Atlassian Forge app for Jira and Confluence
**Publisher / Licensor:** Paul Evans (individual developer)
**Contact:** paul.evans8669@protonmail.com

---

## Summary in plain English

- Trace stores **links** between a Jira issue and a Confluence page or blog post, the
  **documentation status** of each link, and a **history** of who changed that status and when.
- The only personal data Trace stores is an **Atlassian account ID** — an opaque identifier
  Atlassian already assigns to every user — recorded against each status change so the panel can
  show who moved a link along.
- Trace does **not** store page content, issue descriptions, summaries, comments, attachments,
  names, email addresses or avatars. Titles and summaries you see in the panels are fetched live
  from Jira and Confluence each time a panel renders, then discarded.
- Everything Trace stores lives in a **Forge SQL database hosted and operated by Atlassian**, on
  Atlassian's infrastructure. The developer runs no servers, no database and no backups of his
  own, and holds no copy of your data.
- Trace makes **no network calls outside Atlassian**. There is no analytics, no telemetry, no
  tracking, no advertising and no third-party sub-processor.
- Trace only ever reads Jira and Confluence **as the signed-in user**, so it can never show you
  anything you could not already see yourself.
- When the app is uninstalled, Atlassian purges the app's data.

The rest of this document states the same thing in the detail the Atlassian Marketplace and data
protection law expect.

---

## 1. Scope

This policy describes how the Trace app handles data when it is installed on an Atlassian Cloud
site. It covers the app only. It does not cover Atlassian's own handling of your Jira and
Confluence data, which is governed by the
[Atlassian Privacy Policy](https://www.atlassian.com/legal/privacy-policy) and your agreement
with Atlassian.

## 2. Roles: who holds your data

Trace is built on [Atlassian Forge](https://developer.atlassian.com/platform/forge/). This is
central to understanding where your data lives:

- **Your organisation** controls the Jira and Confluence content that Trace references, and
  decides whether to install Trace at all.
- **Atlassian** hosts and operates everything. The app's code runs on Atlassian's servers as a
  Forge function, and the app's database is a **Forge SQL** instance provisioned, hosted,
  encrypted, backed up and operated **by Atlassian on Atlassian infrastructure**. The data
  resides in the region Atlassian assigns to the app for your site.
- **The developer** (Paul Evans) writes and publishes the app logic. He operates no server, no
  database and no storage of his own, receives no copy of your data, and cannot reach the
  database other than through the app's own code executing inside Forge on your site.

In practice this means data residency, encryption at rest and in transit, network security,
backups and physical security are determined by **Atlassian's** practices, not by the developer.
See the [Atlassian Trust Center](https://www.atlassian.com/trust) and
[Cloud data residency](https://www.atlassian.com/trust/data-management/data-residency).

Because the app stores nothing outside Atlassian, there is no international transfer of your
data by the developer, and there are no sub-processors.

## 3. What Trace stores

Trace's database holds two tables, and nothing else.

### 3.1 Links (`content_ticket_links`)

One row per link between a piece of Confluence content and a Jira issue.

| Field | Description | Personal data? |
| --- | --- | --- |
| `id` | Internal identifier for the link | No |
| `content_id` | Confluence page or blog post ID | No |
| `content_type` | `page` or `blogpost`, read from Confluence rather than from the request | No |
| `jira_issue_key` | Jira issue key, e.g. `TRACE-42` | No |
| `link_status` | Documentation status (`not_started`, `ongoing_work`, `needs_review`, `needs_rework`, `done`) | No |
| `linked_at`, `updated_at`, `last_transition_at`, `unlinked_at` | Timestamps | No |
| `last_transition_version` | The Confluence page version at the time of the last status change, so the UI can show whether the page changed afterwards | No |

### 3.2 Status history (`content_ticket_link_transitions`)

An append-only audit trail, one row per status change.

| Field | Description | Personal data? |
| --- | --- | --- |
| `id`, `link_id`, `content_id`, `jira_issue_key` | Identifiers for the link the change applies to | No |
| `link_status` | The status moved to | No |
| `transition_version` | Confluence page version at the time of the change | No |
| `transitioned_at` | Timestamp of the change | No |
| `transitioned_by_account_id` | **Atlassian account ID of the user who made the change** | **Yes** |

The Atlassian account ID is an opaque identifier already issued by Atlassian to every user of
your site. Trace stores it so the history view can attribute a status change to a person. Trace
does **not** store the corresponding name, email address, avatar or any other profile field;
those are resolved by Atlassian's own UI components at display time.

### 3.3 What Trace never stores

Page bodies, blog post bodies, issue summaries, descriptions, comments, attachments, labels,
custom field values, names, email addresses, avatars, IP addresses, browser fingerprints,
cookies or any usage analytics.

Titles, issue summaries, issue types, icons and page versions shown in the panels are fetched
from Jira and Confluence at the moment a panel renders and are discarded when the request ends.

## 4. Data Trace reads, and why

Trace requests the minimum set of Atlassian scopes needed for its features.

| Scope | Why it is needed |
| --- | --- |
| `read:jira-work` | Issue summaries, issue types and icons shown in the panels, and checking that the viewer can see an issue |
| `read:confluence-content.summary` | Page and blog post titles, spaces and links |
| `read:page:confluence` | Page versions and the page visibility check |
| `read:blogpost:confluence` | Blog post versions and the blog post visibility check |
| `search:confluence` | The content picker's search, and batched lookups by ID |

Trace requests **no write scopes** for Jira or Confluence. It cannot modify, create or delete
your pages, issues or comments. It only writes to its own database.

## 5. Access control

All product API calls are made **as the signed-in user** (`asUser`), never with elevated app
permissions. Consequently:

- Trace can only display content the current user is already entitled to see in Jira or
  Confluence.
- Because the app's own database has no permission model of its own, every read path
  re-checks stored rows against the product before returning them. A link to a page or issue you
  cannot access is filtered out, so the app cannot be used to discover the existence of
  restricted issues or pages.

## 6. Retention and deletion

- **Link and history rows** are retained for as long as the app is installed, so the audit trail
  remains meaningful.
- **Unlinking** a page from an issue is a soft delete: the link is marked as unlinked and stops
  appearing in the panels, while its history is preserved for auditing.
- **Deleting a page, blog post or issue** in the product triggers the same soft unlink
  automatically, so rows do not outlive the content they describe in the user interface.
- **Uninstalling the app** removes Trace's access and causes Atlassian to delete the app's data
  in accordance with Forge's data lifecycle. The developer retains no copy, because he never had
  one.

To request deletion of specific data while the app remains installed, contact the developer at
paul.evans8669@protonmail.com or ask your Atlassian site administrator, who can remove links
directly in the app.

## 7. Logging

Forge captures application logs for troubleshooting, retained and controlled by Atlassian and
visible to your site administrators and to the developer through the Forge CLI. Trace's logging
is deliberately conservative:

- Database errors log the failing statement shape and **the number** of bound parameters, never
  the parameter values — precisely because those values are content IDs, issue keys and account
  IDs.
- The cleanup handlers log the Confluence content ID or Jira issue key of deleted content, so
  administrators can trace an automated cleanup.

Trace does not log page content, issue content or user profile data.

## 8. Your rights

Where data protection law such as the GDPR applies, individuals have rights of access,
rectification, erasure, restriction, objection and portability. Because the only personal data
Trace stores is an Atlassian account ID held inside your own Atlassian site:

- Requests are normally fastest through **your Atlassian site administrator**, who controls the
  installation and can remove links or uninstall the app.
- You may also contact the developer at paul.evans8669@protonmail.com. Requests will be
  answered within 30 days.

## 9. Children

Trace is a workplace tool distributed through the Atlassian Marketplace and is not directed at
children. It does not knowingly collect data from anyone under 16.

## 10. Security incidents

The app stores data exclusively in Atlassian-operated infrastructure, so incident response for
that infrastructure is Atlassian's. If the developer becomes aware of a vulnerability or
incident affecting the app's own code, affected installations will be notified without undue
delay and a fix published through the Marketplace. To report a vulnerability, email
paul.evans8669@protonmail.com.

## 11. Changes to this policy

Material changes will be published in this file with an updated effective date and released as a
new version of the app. The current version is always available in the app's repository.

## 12. Contact

Paul Evans — paul.evans8669@protonmail.com

---

*This policy describes the behaviour of the Trace app as implemented. It is a factual
description, not legal advice.*
