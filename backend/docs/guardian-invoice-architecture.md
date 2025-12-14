# Guardian Invoice System — Modernized Architecture

## 1. Objectives

- Guarantee financial accuracy (no duplicate class billing, currency rounding to cents, traceable adjustments)
- Support **Monthly** and **Pay-As-You-Go** guardians with automated generation & reconciliation
- Provide transactional updates that keep guardian balances, student hours, and class flags in sync
- Enable an intuitive admin/guardian experience with real-time status, exports, and proactive alerts
- Maintain a full audit trail for compliance (who did what, when, and why)

## 2. Core Entities & Schemas

### 2.1 Invoice

```ts
Invoice {
  _id: ObjectId
  invoiceNumber: string // e.g. INV-2025-10-0001 (global monotonic sequence)
  guardian: ObjectId<User>
  billingType: 'monthly' | 'payg'
  billingPeriod: { start: Date, end: Date }
  issuedAt: Date
  dueDate: Date
  status: 'draft' | 'pending' | 'sent' | 'overdue' | 'paid' | 'partially_paid' | 'cancelled' | 'refunded'
  generationSource: 'auto-monthly' | 'auto-payg' | 'manual'
  items: InvoiceItem[]
  subtotal: number
  discounts: number
  transferFees: { mode: 'flat' | 'percent', value: number, amount: number }
  tips: number
  total: number // subtotal - discounts + fees + tips
  paidAmount: number
  remainingAmount: number // derived
  hoursCovered: number
  classIds: ObjectId<Class>[] // redundant cache for fast duplicate lookups
  excludedClassIds: ObjectId<Class>[] // explicit exclusions
  adjustments: Adjustment[]
  paymentLogs: PaymentLog[]
  activityLog: ActivityEntry[]
  delivery: {
    status: 'not_sent' | 'sent' | 'whatsapp_scheduled',
    channels: DeliveryRecord[]
  }
  audit: { createdBy, updatedBy, createdAt, updatedAt }
}
```

### 2.2 InvoiceItem

```ts
InvoiceItem {
  _id: ObjectId
  classId: ObjectId<Class> | null
  studentId: ObjectId<User> | null
  teacherId: ObjectId<User> | null
  lessonSnapshot: {
    title: string
    subject: string
    scheduledDate: Date
    durationMinutes: number
  }
  rate: number // USD/hour
  quantityHours: number
  excludeFromGuardian: boolean
  excludeFromTeacher: boolean
  amount: number
  attendanceStatus: 'attended' | 'student_absent' | 'teacher_absent' | 'cancelled'
}
```

### 2.3 Adjustment

```ts
Adjustment {
  _id: ObjectId
  reason: string
  amount: number // positive reduces invoice, negative increases
  appliesTo: 'guardian' | 'teacher' | 'both'
  createdBy: ObjectId<User>
  createdAt: Date
}
```

### 2.4 PaymentLog

```ts
PaymentLog {
  _id: ObjectId
  amount: number
  method: 'cash' | 'paypal' | 'bank' | 'card' | 'refund'
  tip: number
  transactionId?: string
  paidAt: Date
  recordedBy: ObjectId<User>
  note?: string
  snapshot: {
    guardianBalanceBefore: number
    guardianBalanceAfter: number
    invoiceRemainingBefore: number
    invoiceRemainingAfter: number
  }
}
```

### 2.5 GuardianBalance (new view)

- Calculated, not stored: `guardianInfo.totalHours` remains authoritative.
- Introduce helper service to compute `hoursRemaining`, `monetaryBalance`, and `nextBillingThreshold` using invoices + class data.

### 2.6 InvoiceAudit (new collection)

```ts
InvoiceAudit {
  _id: ObjectId
  invoiceId: ObjectId<Invoice>
  actorId: ObjectId<User>
  at: Date
  action: 'create' | 'update' | 'payment' | 'refund' | 'edit_items' | 'delivery' | 'status_change'
  diff: Record<string, { before: any, after: any }>
  meta?: Record<string, any>
}
```

## 3. Invariants & Validation Rules

1. **No class duplication** — `items.classId` must be unique across **all** invoices whose status ∈ {draft, pending, sent, overdue, paid, partially_paid}.
2. **Every attended class must be invoiced** — background job ensures past, billable classes exist in at least one invoice within 24h.
3. **Totals are deterministic** — `grandTotal = round(subtotal - discounts + transferFees.amount + tips)` with banker's rounding to 2 decimals.
4. **Guardian balance sync** — editing items or adjustments recalculates guardian/student hours and teacher payouts using transactional session.
5. **Idempotent delivery** — sending via WhatsApp/Email tracks message hash to avoid duplicates.
6. **Immutable payment logs** — once recorded, `PaymentLog` entries cannot be modified, only appended with reversal records.

## 4. Automation Workflows

### 4.1 Monthly Guardians

- Trigger: Cron 00:15 admin TZ on day 1
- Steps:
  1. Determine billing window `{ start = first day, end = last day }` and expected classes.
  2. Fetch all classes within window not already linked to any invoice.
  3. Create invoice with status `pending`, dueDate = start + 14 days.
  4. Send summary notification to admin + optional auto-email.
  5. Update guardian `pendingInvoiceId` for quick lookup.

### 4.2 Pay-As-You-Go

- Trigger: On class report submission, payment logging, or hourly cron.
- Guard condition: guardianRemainingHours ≤ `threshold` (lowest upcoming class duration in hours).
- Action: generate invoice covering **all unbilled classes** since last invoice, set due date = now + 7 days.

### 4.3 Reconciliation Hooks

- When invoice items change:
  - Revalidate unique class constraint.
  - Recompute totals, update guardian/student hours inside Mongo transaction.
  - Append `InvoiceAudit` entry.
- When class attendance changes:
  - Queue reconciliation job to adjust invoices (remove or reassign items) or mark invoice for review.

## 5. API Surface (v2)

### 5.1 Listing

`GET /api/invoices?tab=upcoming|previous&status=&billingType=&guardian=&search=`

- `tab=upcoming` → status in {pending, sent, overdue}
- `tab=previous` → status in {paid, partially_paid, cancelled, refunded}
- Sorting:
  - Upcoming: `firstClassDate ASC`
  - Previous: `paidDate DESC`
- Response includes delivery history, guardian summary, outstanding hours.

### 5.2 Detail

`GET /api/invoices/:id`

- Embeds guardian, students, teacher summaries, calculation breakdown, audit history, delivery status.

### 5.3 Unified Update (modal)

`PUT /api/invoices/:id`
Body:

```json
{
  "billingPeriod": { "start": "2025-10-01", "end": "2025-10-31" },
  "items": { "add": [...], "update": [...], "remove": [...] },
  "adjustments": [...],
  "transferFees": { "mode": "percent", "value": 3 },
  "tip": 5,
  "notes": "string",
  "status": "sent"
}
```

- Server validates, applies within a transaction, emits audit record.

### 5.4 Payments

`POST /api/invoices/:id/payments`

```json
{
  "amount": 150,
  "method": "paypal",
  "transactionId": "PAY-123",
  "tip": 10,
  "note": "Manual adjustment",
  "paidAt": "2025-10-02T16:30:00Z"
}
```

- Returns updated invoice summary + guardian balance snapshot.

### 5.5 Refunds & Reversions

`POST /api/invoices/:id/refunds`

- Creates negative payment log, adjusts guardian hours accordingly.

### 5.6 Delivery

`POST /api/invoices/:id/deliver`

```json
{
  "channel": "whatsapp" | "email",
  "templateId": "invoice_due",
  "force": false
}
```

- Enforces idempotency via message hash.

### 5.7 Exports

`GET /api/invoices/:id/export?format=pdf|docx`

- Returns generated file.

## 6. Background Jobs & Scheduling

| Job                        | Schedule      | Responsibility                             |
| -------------------------- | ------------- | ------------------------------------------ |
| `generateMonthlyInvoices`  | Day 1 @ 00:15 | Monthly guardians                          |
| `checkZeroHourGuardians`   | Hourly        | Trigger pay-as-you-go invoices             |
| `reconcileUnbilledClasses` | Daily @ 02:00 | Ensure all past classes invoiced           |
| `invoiceStatusWatcher`     | Hourly        | Promote `sent` → `overdue`, send reminders |
| `deliveryRetryQueue`       | 5 min         | Retry WhatsApp/email failures              |

All jobs emit structured logs & metrics (success count, failures) for monitoring dashboards.

## 7. Transactions & Error Handling

- Use MongoDB multi-document transactions (with retry) when mutating invoices + guardian/student documents.
- On failure, respond with actionable error messages and leave invoice in `pending_review` state with admin alert.
- Wrap delivery integrations with circuit-breaker & exponential backoff.

## 8. Security & Integrity

- Role-based guard: only admins can edit guardian invoices; guardians can view & download their own.
- Sensitive operations require OTP or re-auth (optional stretch).
- All exports stored temporarily in signed URLs, auto-expired after 24h.

## 9. Migration Plan

1. Add new schema fields (status variants, delivery, audit collection) via migration script.
2. Backfill existing invoices: compute `classIds`, `hoursCovered`, `delivery.status`.
3. Re-index `items.classId` with partial unique index.
4. Enqueue reconciliation job for invoices missing class linkage.
5. Roll out new API endpoints alongside legacy ones; retire legacy once frontend moves over.

## 10. Frontend Experience (Preview)

- Two-tab layout (Upcoming / Previous) with global search, filters by status, billing type, guardian, student.
- Unified "View & Edit" modal featuring summary + inline editing (items, fees, payments) with optimistic UI.
- Action bar per invoice: `View`, `Record Payment`, `Send WhatsApp`, `Export`, `More` (cancel/refund).
- Badge indicators for delivery status, overdue days, pending adjustments.

## 11. Testing Strategy

- Unit tests for calculators (totals, fees, rounding, threshold detection).
- Integration tests for invoice creation, duplicate prevention, payment/ refund flows.
- Contract tests for delivery service stubs.
- Cypress (or RTL) tests covering frontend tabs, filtering, modal operations.

## 12. Monitoring & Metrics

- Emit metrics to internal dashboard: invoices generated, overdue count, average payment time, duplicate prevention hits.
- Hook into notification service for admin alerts on reconciliation failures or transaction retries.

---

This document serves as the blueprint for the modernization tasks that follow. Implementation will adhere to these contracts, adjusting only if blockers are discovered during development.
