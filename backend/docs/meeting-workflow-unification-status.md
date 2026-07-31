# Meeting Workflow Unification - Implementation Status

## Implemented (This Patch)

### Milestone 1 - Data Contract and Schema Additions
- `Meeting` schema additions:
  - `links.studentIds[]`
  - `links.guardianStudentSubIds[]`
  - `links.teacherId`
  - `links.classId`
  - `links.evaluationSessionId`
  - `links.recruitment.{sourceModel,sourceId}`
  - `report.meta.{version,source,sourceRef,sourceModule,idempotencyKey}`
- `Meeting` indexes added:
  - `{ 'links.studentIds': 1, scheduledStart: 1 }`
  - `{ 'links.teacherId': 1, scheduledStart: 1 }`
  - `{ 'links.classId': 1 }`
- `Class` schema additions:
  - `interaction.meetingId`
  - `interaction.reportSource`
  - `interaction.reportSyncedAt`
  - `interaction.reportVersion`

### Milestone 2 - Unified Command Foundations
- New service: `backend/services/interactionService.js`
  - `syncClassReportToCanonicalMeeting(...)`
  - `listStudentInteractions(...)`
  - `listTeacherInteractions(...)`
- Integrated classes report submission with canonical interaction sync:
  - `backend/routes/classes.js` now calls `syncClassReportToCanonicalMeeting` after class report save.
- Enhanced meeting report save metadata versioning:
  - `backend/services/meetingService.js` now updates `report.meta` and refreshes `links.studentIds` / `links.teacherId` during report submit.

### Milestone 3 - Timeline Read APIs (Backend)
- Added student timeline endpoint:
  - `GET /api/students/:id/interactions`
- Added teacher timeline endpoint:
  - `GET /api/users/:id/teacher-interactions`
- Frontend API helpers:
  - `frontend/src/api/students.js` -> `getStudentInteractions(...)`
  - `frontend/src/api/users.js` -> `getTeacherInteractions(...)`

### Milestone 4 - Migration Tooling (Initial)
- Added migration/backfill script:
  - `backend/scripts/backfillMeetingInteractionLinks.js`
- Added package scripts:
  - `npm run dryrun:meeting-interactions`
  - `npm run backfill:meeting-interactions`

## Pending Work

### Milestone 2 (Remaining)
- Route-level idempotency-key enforcement on report endpoints.
- Move meeting/class report writes behind one explicit command endpoint.

### Milestone 3 (Remaining)
- Build profile UI tabs that consume timeline endpoints.
- Add normalized interaction detail drawer component.

### Milestone 4 (Remaining)
- Expand backfill to map recruitment links and evaluation session links.
- Add duplicate-candidate resolver (`mergedTo`) policy and audit output.

### Milestone 5
- Concurrency guards (optimistic version conflict handling).
- Outbox/event log for projection + notifications.
- End-to-end tests and phased rollout flags.
