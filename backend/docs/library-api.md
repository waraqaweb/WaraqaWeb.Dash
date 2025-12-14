# Digital Library API (Phase 2)

This document tracks the backend endpoints that power the digital library. All routes live under `/api/library` (main browsing & items) and `/api/library/shares` (access workflows). Authentication uses the existing JWT middleware; only admins can mutate library structures.

## Library browsing (`/api/library`)

| Method | Path                                         | Description                                                                            | Auth                                    |
| ------ | -------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| GET    | `/api/library`                               | Root listing. Supports `parentId`, `includeItems`, `page`, `limit`, `search`.          | Authenticated (teacher/guardian/admin). |
| GET    | `/api/library/folders/:folderId`             | Fetch the contents of a specific folder with pagination + search.                      | Authenticated.                          |
| GET    | `/api/library/folders/:folderId/breadcrumbs` | Returns breadcrumb trail for navigation.                                               | Authenticated.                          |
| POST   | `/api/library/folders`                       | Admin-only creation of folders/subjects/levels.                                        | Admin.                                  |
| PATCH  | `/api/library/folders/:folderId`             | Admin updates (rename, move, toggle secret/download flags, manage secret access list). | Admin.                                  |
| DELETE | `/api/library/folders/:folderId`             | Remove empty folders.                                                                  | Admin.                                  |
| POST   | `/api/library/items`                         | Admin metadata creation after upload completes (Cloudinary direct upload).             | Admin.                                  |
| PATCH  | `/api/library/items/:itemId`                 | Admin updates to metadata, download flag, preview assets.                              | Admin.                                  |
| DELETE | `/api/library/items/:itemId`                 | Delete item + Cloudinary asset.                                                        | Admin.                                  |
| GET    | `/api/library/items/:itemId`                 | Fetch item metadata plus permission summary.                                           | Authenticated.                          |
| GET    | `/api/library/items/:itemId/pages`           | Returns incremental page previews; accepts `page` + `limit`.                           | Authenticated.                          |
| GET    | `/api/library/items/:itemId/download`        | Generates a signed Cloudinary URL if the caller has download permission.               | Authenticated + approved share.         |
| GET    | `/api/library/items/:itemId/annotations`     | Returns the caller’s most recent snapshot for the requested page.                      | Authenticated.                          |
| PUT    | `/api/library/items/:itemId/annotations`     | Save/update strokes/text for a page (rate-limited, ephemeral by default).              | Authenticated.                          |
| DELETE | `/api/library/items/:itemId/annotations`     | Clear annotations for a page.                                                          | Authenticated.                          |

### Access control highlights

- Viewing non-secret folders/items is allowed for any logged-in teacher/guardian/student, but secret folders require either admin privileges, explicit secret access list entries, or an approved share.
- Downloads always require explicit permission: admin approval, a share with `downloadAllowed`, or a space-wide grant. Without it, `/download` returns 403 even if the item is visible.
- Share tokens can be passed via `shareToken` query or `x-library-share` header for future guest links.

### Annotation behavior

- Snapshots are stored per `(item, user, page)` with an auto-expiring TTL (6 hours) unless the caller sets `persist=true`.
- Rate limiting is enforced (`60s` window / `40` writes).
- Undo/redo depths and active tool metadata persist alongside stroke/text payloads.

## Share & permission workflows (`/api/library/shares`)

| Method | Path                                         | Description                                                                                                            | Auth           |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------- |
| POST   | `/api/library/shares/requests`               | Submit a request (guest or logged-in). Requires `scopeType`, `targetId` (except space), `email`, `fullName`, `reason`. | Optional auth. |
| GET    | `/api/library/shares/mine`                   | Logged-in users view their pending/approved/denied shares.                                                             | Authenticated. |
| GET    | `/api/library/shares/requests`               | Admin queue of pending/approved/denied requests with audit data.                                                       | Admin.         |
| POST   | `/api/library/shares/:permissionId/decision` | Admin approves/denies, toggles download, sets expiry.                                                                  | Admin.         |
| POST   | `/api/library/shares/:permissionId/revoke`   | Admin revokes an active share.                                                                                         | Admin.         |

### Share scopes

- `item`: access to a single book/resource.
- `folder`: access to a level/subject; `includeDescendants=true` cascades to nested folders.
- `space`: global access (usually temporary). Used for event-wide sharing.

### Notifications

- Every new request notifies admins.
- Approved/denied decisions notify the requester (if they have an account).

## Storage helpers

- `libraryStorageService` now emits signed upload payloads (regular + resumable) and signed download URLs that respect resource types (`image`, `video`, `raw`).
- Uploaders should continue to use direct Cloudinary uploads; once complete, call `POST /api/library/items` with the Cloudinary response mapped into the `storage` object.

## Error codes

- `FOLDER_NOT_FOUND`, `ITEM_NOT_FOUND`, `ITEM_FORBIDDEN`, `DOWNLOAD_FORBIDDEN` etc. bubble through Express error middleware, making it easy for the frontend to show precise user feedback.

Use this document as the reference when wiring the frontend library dashboard, viewer, and admin queue (Phase 3+).
