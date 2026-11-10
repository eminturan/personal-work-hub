# Personal Work Hub

**English** | [Türkçe](README.tr.md)

An Azure DevOps extension that adds a **My Work** page to the Boards menu and shows your work
items, pull requests and pipeline runs from every project in the collection on one page. It only
reads data.

Built for and tested on Azure DevOps Server 2022. Azure DevOps Services is not supported.

## Features

The page has three sections, each with two lists.

**Work Items**

- Assigned to me, and Created by me
- Closed, completed and cancelled work items are hidden by default; a checkbox includes them
- State badges are coloured: completed and closed in green, cancelled in red, everything else neutral

**Pull Requests**

- Created by me: your active pull requests
- Assigned to me for review: pull requests where you are a reviewer directly or through a team or
  group you belong to, including the ones you already approved
- The review list shows how the pull request reached you (directly, or the group name) and your
  vote. If you did not vote but another member voted for your group, it shows the group's vote
- A checkbox adds completed pull requests to both lists

**Pipelines**

- Build: the last 50 builds that ran for you (`requestedFor`), so CI builds triggered by your
  push are included
- Release: the last 50 releases you created, with one badge per stage

**On every list**

- Search across all visible columns
- Drop-down filters built from the values currently in the list (type, state, project,
  repository, creator, vote, pipeline, status)
- Rows link to the work item, pull request or run
- Refreshes every 5 minutes; Refresh button
- English and Turkish UI

## Install

Build the package (see below), then on your server: Collection Settings → Extensions → Browse
local extensions → Manage extensions → Upload extension, and install it into the collection. The
page appears under **Boards → My Work** in every project and shows the same content whichever
project you open it from.

## Permissions

| Scope | Used for |
| --- | --- |
| `vso.work` | Run the work item queries and read work item fields |
| `vso.code` | Read pull requests |
| `vso.build` | Read builds |
| `vso.release` | Read releases |
| `vso.project` | List projects and the teams you belong to |
| `vso.identity` | Read your group memberships |

## Security

- **Read-only.** The extension reads data only. The two `POST` requests it makes (`wit/wiql` and
  `wit/workitemsbatch`) are queries; nothing is created, changed or deleted.
- **The user's own permissions apply.** Every request is made as the signed-in user; the server
  decides what that user may see. The access token is sent only to the collection URL and is not
  stored or logged.
- **Links.** Only `http` and `https` addresses are rendered as links.
- **Diagnostics.** The collapsed Diagnostics block at the bottom of the page holds counts and
  error messages only, no titles or names.

## How it finds your work

| List | Source |
| --- | --- |
| Work Items → Assigned to me | WIQL `[System.AssignedTo] = @Me` |
| Work Items → Created by me | WIQL `[System.CreatedBy] = @Me` |
| Pull Requests → Created by me | `git/pullrequests?searchCriteria.creatorId` |
| Pull Requests → Assigned to me for review | `searchCriteria.reviewerId` for you, plus a scan of the active pull requests whose reviewers are compared with your teams and groups |
| Pipelines → Build | `build/builds?requestedFor`, asked per project |
| Pipelines → Release | `release/releases?createdBy`, collection first, then per project |

Your teams come from `teams?$mine=true` and your groups from `identities?queryMembership`. A user
can be a member of hundreds of groups, so group assignments are found with one scan of the active
pull requests instead of one query per group.

Azure DevOps Server 2022 rejects the build list without a project (HTTP 400, VS800075), so builds
are always asked project by project.

## Known limitations

- At most 200 work items per list, 100 pull requests per list and 50 runs per list. A note appears
  when a list hits its limit.
- The active pull request scan stops at 5,000.
- Completed pull requests in the review list are only those where you are a reviewer yourself.
- The states treated as closed are the fixed list `CLOSED_STATES` in `src/hub/logic.ts`. A custom
  state with another name is treated as open; add it to the list and to `stateTone` for the colour.
- Filters work on the rows that are loaded. Closed states appear in the State filter only after
  the checkbox is ticked.
- The page follows the browser language; Server 2022 does not expose the profile language to
  extensions. The menu entry is always "My Work".

## Development

```bash
npm install
```

```bash
npm run dev
```

The page opens at `http://localhost:3001/hub/hub.html` with sample data from `src/hub/mock.ts`.
Outside Azure DevOps the SDK is not used; real data only appears once the extension is installed.
Add `?lang=en` or `?lang=tr` to pick the language.

```bash
npm test
```

```bash
npm run package
```

The package is written to `out/`. Increase `version` in both `vss-extension.json` and
`package.json` before every upload; the server refuses a package with a version it already has.

To publish to the Marketplace (needs a personal access token for the `turanemin` publisher):

```bash
npm run publish:marketplace -- --token <PAT>
```

### Structure

| File | Contents |
| --- | --- |
| `vss-extension.json` | Manifest: hub contribution, scopes |
| `overview.md` | Marketplace page |
| `src/hub/hub.tsx` | UI and SDK start-up |
| `src/hub/api.ts` | REST calls (`api-version=7.0`) |
| `src/hub/logic.ts` | Queries, mapping and rules (pure functions, tested) |
| `src/hub/i18n.ts` | English and Turkish strings, language selection |
| `src/hub/mock.ts` | Sample data for development |
| `tests/logic.test.ts` | Unit tests, including the REST source against a fake server |

## License

MIT. Developed by Emin Turan.
