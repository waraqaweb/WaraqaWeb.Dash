# Digital Library Data Model

Phase 1 introduces dedicated MongoDB models for the upcoming digital library. These models are designed to be flexible, role-aware, and ready for resumable uploads plus signed delivery URLs.

## LibraryFolder

- Represents subjects, levels, or any nested grouping.
- Key fields: `displayName`, `slug`, `subject`, `level`, `tags`, `previewAsset`, `parentFolder`, `ancestors`, and `stats` (denormalised item counts and storage size).
- Secret sections use `isSecret` plus `secretAccessList`, ensuring only whitelisted users/emails can see the folder tree.
- Helper methods: `userHasSecretAccess`, `allowsUser`, and `toBreadcrumb`.

## LibraryItem

- Stores actual resources (books, series, multimedia).
- References its parent folder and reuses shared preview + storage sub-schemas.
- Tracks metadata (`contentType`, `pageCount`, `language`, `curriculum`, etc.), download policy, annotation versioning, and search keywords.
- `effectiveSecret` virtual ensures folder-level secrecy carries over when `inheritsSecret` is true.

## LibrarySharePermission

- Centralises approval workflow for guardians/non-users requesting access.
- Supports folder/item/space scopes, descendant inclusion, download limits, expirations, audit log entries, and email-only invitations.
- `isActive` and `applyDecision` helpers keep routing logic simple once APIs arrive.

## LibraryAnnotationSnapshot

- Per-user/page annotation cache with lightweight JSON payloads for strokes + text.
- Includes TTL index for ephemeral entries, undo/redo depth tracking, and optimistic version bumping.

## Shared Sub-schemas & Constants

- `libraryConstants.js` enumerates content types, statuses, tools, and storage providers.
- `librarySubschemas.js` houses preview assets, storage locators, secret access entries, share audits, page previews, and annotation payloads for consistent reuse.

## Storage Service

- `services/libraryStorageService.js` wraps our Cloudinary integration for library assets.
- Provides helpers to:
  - Resolve deterministic folder paths (`subject/level`).
  - Generate signed upload payloads (regular + resumable) with unique public IDs.
  - Map Cloudinary responses into the storage locator schema.
  - Produce expiring signed download links.
  - Delete assets safely.

These primitives unblock Phase 2 (routes + services) by giving us validated schemas, indexes, and storage utilities that align with existing infrastructure and security expectations.
