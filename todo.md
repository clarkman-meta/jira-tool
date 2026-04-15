# Jira Issue Monitor - TODO

## Backend
- [x] Store Jira credentials (email + API token) as server-side secrets
- [x] Create project config table in DB (id, key, name, codename, color, jiraUrl, order)
- [x] Seed default projects: Dragon (DGTK), SSG (TPZ), Hypernova2 (KITE)
- [x] Build Jira API proxy tRPC route: fetch open issues with fields (key, summary, status, assignee, updated, comment)
- [x] Parse latest comment body from Jira ADF format to plain text
- [x] Build admin tRPC routes: list/add/edit/delete projects

## Frontend
- [x] Design system: dark elegant theme, color palette, typography (Inter font)
- [x] DashboardLayout with sidebar showing project list
- [x] Project issues page: sortable table with issue key, title, latest comment, status, assignee, updated
- [x] Highlight rows assigned to Clark Hsu (accountId: 712020:f04ded31-3e91-47eb-bad9-d5e624e2b95f)
- [x] Sort by: updated date, status, assignee, issue key
- [x] Auto-refresh toggle (every 5 min) + manual refresh button
- [x] Issue row click → open Jira issue in new tab
- [x] Admin page: list projects, add/edit/delete project entries
- [x] Responsive design

## Testing
- [x] Vitest: Jira API proxy route
- [x] Vitest: project CRUD routes (covered in jira.test.ts)

## New Columns (Round 2)
- [ ] Investigate Jira fields: priority (P0/P1/P2), reporter, fixVersions/customField for Build
- [ ] Update server/jira.ts to fetch reporter, fixVersions, and custom build fields
- [ ] Add Priority, Reporter, Build columns to the issue table in Dashboard.tsx
- [ ] Make new columns sortable
- [ ] Update vitest tests for new fields
- [x] Remove Build column from frontend table and backend jira.ts (not available in Dragon/SSG)
- [x] Add stage filter bar (SMT / FATP / All) that filters issues by keyword match in title and latest comment
- [x] For KITE project, show Build field (customfield_10433) in Priority column instead of standard priority
- [x] Set default sort to priority (asc) then updated (desc) as secondary
- [x] Exclude issues with status "Closed" from JQL query

## Watch List Feature
- [x] Add watched_issues and hidden_issues tables to DB schema
- [x] Add tRPC routes: list/add/remove watched issues, list/add/remove hidden issues
- [x] In issue table: pin watched issues to top with a star indicator, filter out hidden issues
- [x] Add Watch List management panel (sidebar or modal): input to add issue key, list to remove
- [x] Watched issues pinned to top of table (already in open issues list)

## Bug Fixes
- [x] Fix issue count discrepancy: implemented cursor-based pagination to fetch ALL pages (was only fetching first 100/200 issues)
- [x] Investigate why unrelated issues (e.g. Leo) appear in DGTK results — codename embedded in title only
- [x] Add titleFilter per-project keyword filter: server-side filtering by title keywords (comma-separated), configurable in Admin UI

## Round 4
- [x] Fetch real JQL filter from Diamond board (DGTK-234 board) and Hypernova2 dashboard (29923) and apply as titleFilter
- [x] Build Pinned Issues feature: add issue key → fetch from Jira → pin to top with special highlight + delete icon (PinnedIssuesMerger component, shows even if not in open list)

## UX Improvements (Round 5)
- [x] Move Pin/Hide input controls from sidebar bottom into the filter bar area above the table
- [x] Add per-row hide (×) delete button as the last column in the issue table

## Round 6 - Filter by Dashboard JQL
- [x] Fetch JQL from Jira dashboard 31186 (gadget 105884) — found parent=DGTK-234 pattern

## Round 6 - Per-Project Custom JQL
- [x] Add customJql column to jira_projects DB table
- [x] Update backend jira.ts to use customJql when present (override default JQL)
- [x] Seed Dragon: parent = DGTK-234 AND statusCategory != Done AND status != Closed
- [x] Seed Hypernova2: project = KITE AND "Build[Dropdown]" IN (P0,P1) AND status NOT IN (Closed, Done)
- [x] Seed SSG (TPZ): project = TPZ AND summary ~ "[P2]" AND statusCategory != Done AND status != Closed
- [x] Update Admin UI to show/edit customJql field per project (textarea with full JQL editing)

## Round 7 - My Issues Toggle
- [x] Add "My Issues" toggle button in the filter bar to filter issues assigned to Clark Hsu

## Round 8 - Enhanced My Issues
- [x] Investigate Jira JQL support for watcher, commenter, reporter involvement
- [x] Enhance My Issues: include issues where I am assignee, reporter, commenter, watcher/subscriber, or task owner
- [ ] Also include Task issue type in the filter (not just Bug/FA for Dragon)

## Round 9 - Default My Issues + Time Filter
- [x] Set My Issues toggle to ON by default (click to show all issues)
- [x] Add flexible time filter: quick preset chips (7d/14d/30d/90d) + free-input days field, default 30 days
- [x] Time filter applies to updatedDate field client-side (issues with updated > now - N days)

## Round 10 - Expand My Issues (Involvement)
- [x] Test Jira JQL: watcher = accountId, reporter = accountId, comment ~ username — all work natively
- [x] Backend: fetchMyInvolvedIssues() in server/jira.ts — runs involvement JQL and returns Set<string> of issue keys
- [x] Backend: jira.issues tRPC route now accepts myIssues: boolean; when true, fetches involvement keys and intersects with project issues
- [x] Frontend: My Issues toggle state lifted to Dashboard level; passed as myIssues to the tRPC query for server-side filtering
- [x] Tooltip updated to describe full involvement semantics (assignee / reporter / watcher / commenter)

## Round 11 - Priority Filter Chips
- [x] Add P0 / P1 / P2 priority filter chips to the filter bar (Row 2, after time filter)
- [x] Priority filter works client-side: filter issues whose effective priority matches selected level(s)
- [x] Support multi-select (e.g. P0+P1 together) and an × clear button
- [x] For KITE, use build field as effective priority; for others use standard priority field
- [x] Normalise priority values (highest/blocker→p0, high→p1, medium→p2, low→p3, lowest→p4)

## Round 12 - Hidden Issues Management Panel
- [x] Add "Hidden" button in filter bar that shows count badge when there are hidden issues
- [x] Clicking the button opens a dropdown panel listing all hidden issues for the current project
- [x] Each hidden issue row shows the issue key and a "Restore" (eye) button to unhide it
- [x] Restore removes the issue from the hidden list and it reappears in the table immediately
- [x] Panel scoped to the active project (only shows hidden issues for current project key)

## Round 13 - Status Filter
- [x] Add Status multi-select filter to filter bar Row 2 (after priority chips)
- [x] Default: only "In Progress" selected on load
- [x] Show a dropdown with checkboxes for all unique statuses found in current issues (with count per status)
- [x] Client-side filtering: only show issues whose status matches selected statuses
- [x] Clear button inside dropdown; badge shows number of selected statuses

## Round 14 - Status Default + Labels Filter
- [x] Change Status filter default from ["In Progress"] to ["Triage", "In Progress"]
- [x] Add Labels multi-select filter (teal color, similar to Status dropdown), default selected: "SW"
- [x] Fetch labels field from Jira API (server/jira.ts) — added "labels" to fields array and mapIssue()
- [x] Labels filter: client-side, shows all unique labels from current issues with count, supports multi-select + Clear

## Round 15 - Fix Status/Labels Filter Independence
- [x] Bug: Status dropdown options only show statuses present in Labels-filtered issues (and vice versa)
- [x] Fix: allStatuses now computed from issuesForStatusOptions (all filters EXCEPT labels)
- [x] Fix: allLabels now computed from issuesForLabelsOptions (all filters EXCEPT status)
- [x] Counts in each dropdown now reflect the independent base (not cross-filtered)

## Round 16 - Show All Statuses Including Closed/Done
- [x] Remove statusCategory != Done AND status != Closed from server-side JQL default
- [x] Server now fetches issues filtered by statusFilter param (status IN) instead of hardcoded exclusion
- [x] Frontend Status filter now controls all status visibility via server-side JQL

## Round 17 - Server-side Status Filter with Fixed 6 Options
- [x] Update server/jira.ts fetchOpenIssues to accept statusFilter: string[] param, add JQL status IN (...) clause
- [x] Update tRPC router jira.issues to accept statusFilter param and pass to fetchOpenIssues
- [x] Frontend: hardcode 6 fixed Status options (Backlog, Triage, To Do, Blocked, In Progress, Closed)
- [x] Frontend: statusFilter state lifted to Dashboard level, passed to trpc.jira.issues.useQuery
- [x] Remove client-side status filtering from the filtered useMemo (now server-side)
- [x] Default: Triage + In Progress selected; updated test to cover status IN JQL clause

## Round 18 - Fix fetchMyInvolvedIssues Status Restriction Bug
- [x] Bug: fetchMyInvolvedIssues hardcodes AND statusCategory != Done AND status != Closed in JQL
- [x] This causes My Issues + Closed status to return empty (involvement set never includes Closed issues)
- [x] Fix: removed the status restriction from fetchMyInvolvedIssues JQL — now covers all statuses
- [x] All 11 tests pass after the fix

## Round 19 - Auto-Refresh Monitor with Change Notifications
- [x] Add auto-refresh interval setting in toolbar (number input, default 3 min, 0 = disabled)
- [x] Persist interval setting in localStorage so it survives page reloads
- [x] Implement auto-refresh timer with 1-second tick: refetch on interval
- [x] Show countdown indicator in the interval control (e.g. "(2:45)")
- [x] Detect changes: status change, new comment (by latestCommentDate), assignee change, new issue in results
- [x] Request Browser Notification permission when auto-refresh is enabled
- [x] Show browser notification when tab is hidden and changes detected
- [x] Show toast notifications for changes regardless of tab focus

## Round 20 - Precise Commenter/Mentioned Detection
- [x] Add adfHasMention() helper in server/jira.ts to recursively check ADF nodes for accountId mention
- [x] Add fetchCommentInvolvement() in server/jira.ts: batch-fetches comments for a list of issue keys, checks author.accountId and ADF mention nodes (concurrency=8)
- [x] Add enrichWithCommentInvolvement() exported function: given candidate issue keys, adds commenter/mentioned issues to the involvedKeys set
- [x] Update fetchMyInvolvedIssues() to remove comment ~ JQL (imprecise text search) — now only uses assignee/reporter/watcher JQL
- [x] Update routers.ts jira.issues: after JQL involvement, call enrichWithCommentInvolvement() for precise commenter/mentioned detection
