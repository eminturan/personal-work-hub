# Personal Work Hub

Everything that is waiting for you in Azure DevOps, on one page. The extension adds a **My Work**
page to the Boards menu and gathers your work items, pull requests and pipeline runs from every
project in the collection.

## What it shows

The page has three sections, each with two lists:

**Work Items**

- **Assigned to me:** work items assigned to you
- **Created by me:** work items you created
- Closed, completed and cancelled work items are hidden by default; one checkbox brings them back
- State badges are coloured: completed and closed states in green, cancelled states in red

**Pull Requests**

- **Created by me:** your active pull requests
- **Assigned to me for review:** pull requests where you are a reviewer, either directly or through
  a team or group you belong to. The list shows which group the assignment came from and your vote
- If you have not voted but another member voted on behalf of your group, the list says so
  ("Group approved")
- One checkbox adds completed pull requests to both lists

**Pipelines**

- **Build:** the last 50 builds that ran for you
- **Release:** the last 50 releases you created, with the status of each stage

**On every list**

- Search across all visible columns
- Drop-down filters built from the values in the list: type, state, project, repository, creator,
  vote, pipeline, status
- Every row links to the work item, pull request or run
- Counts for all six lists are visible from the top of the page

The page refreshes every 5 minutes and has a Refresh button.

## Languages

The page is available in English and Turkish. Azure DevOps Server 2022 does not give extensions the
language of your profile, so the page follows your browser language: Turkish for Turkish browsers,
English for every other language. The menu entry is always "My Work".

## Requirements

- Azure DevOps Server 2022
- The page shows only what you are already allowed to see in each project

## Permissions

| Scope | Used for |
| --- | --- |
| `vso.work` | Read work items |
| `vso.code` | Read pull requests |
| `vso.build` | Read builds |
| `vso.release` | Read releases |
| `vso.project` | List projects and your teams |
| `vso.identity` | Read your group memberships, to find pull requests assigned to your groups |

The extension is read-only. It changes nothing and sends no data outside your Azure DevOps server.

## Known limitations

- Each work item list shows at most 200 items, each pull request list at most 100, each pipeline
  list the last 50. A note appears when a list hits its limit.
- Pull requests assigned through a group are found by scanning the active pull requests of the
  collection, up to 5,000.
- Completed pull requests in the review list are only those where you are a reviewer yourself,
  not those assigned only to one of your groups.
- The states treated as closed are a fixed list of English and Turkish names (Closed, Done,
  Completed, Removed, Cancelled, Kapalı, Tamamlandı, İptal). A custom state with another name is
  treated as open.
- Releases are those you created; a deployment you started on someone else's release is not listed.

## Release notes

- **0.6.0:** drop-down filters, coloured state badges, group votes on pull requests
- **0.5.0:** group-assigned pull requests found for users in hundreds of groups; Turkish state names
- **0.4.0:** renamed to Personal Work Hub
- **0.3.0:** three sections (Work Items, Pull Requests, Pipelines) with two lists each
- **0.2.0:** completed pull requests, clearer names
- **0.1.0:** first version

## License

Released under the MIT License. Developed by Emin Turan.
