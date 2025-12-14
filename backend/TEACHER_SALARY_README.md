# Teacher Salary System - Backend

Complete backend implementation for automated teacher salary invoice generation and management.

## 🎯 Status: Production-Ready Backend

The backend is **fully functional** and can be used immediately via API or command-line scripts.

---

## 📁 Structure

```
backend/
├── models/
│   ├── TeacherInvoice.js          # Invoice model (682 lines)
│   ├── SalarySettings.js          # Settings model (340 lines)
│   ├── MonthlyExchangeRates.js    # Exchange rates (267 lines)
│   ├── TeacherSalaryAudit.js      # Audit log (316 lines)
│   ├── MonthlyReports.js          # Report cache (198 lines)
│   └── User.js                    # Enhanced with salary fields
│
├── services/
│   └── teacherSalaryService.js    # Business logic (833 lines)
│
├── routes/
│   └── teacherSalary.js           # REST API (515 lines)
│
├── jobs/
│   └── generateTeacherInvoicesJob.js  # Cron job (345 lines)
│
├── middleware/
│   └── auth.js                    # Enhanced with requireTeacher
│
├── scripts/
│   ├── initializeSalarySystem.js        # System initialization
│   ├── testTeacherInvoiceGeneration.js  # Testing workflow
│   ├── updateExchangeRate.js            # Rate management
│   ├── fixSalarySettings.js             # Database repair
│   ├── checkExchangeRates.js            # Rate validation
│   └── checkSystemData.js               # Status checker
│
└── server.js                      # Integrated routes and job
```

---

## 🚀 Quick Start

### 1. Initialize System
```bash
cd backend
node scripts/initializeSalarySystem.js
```

This creates:
- Default salary settings with 4 rate tiers
- Exchange rates for current and past 3 months
- Validates system readiness

### 2. Set Exchange Rates
```bash
node scripts/updateExchangeRate.js 12 2025 32.5 "Central Bank rate"
```

### 3. Test Invoice Generation
```bash
node scripts/testTeacherInvoiceGeneration.js 10 2025
```

### 4. Use the API
Start server and access endpoints at `http://localhost:5000/api/teacher-salary/*`

See `TEACHER_SALARY_QUICK_START.md` for complete API reference.

---

## 🔧 Configuration

### Environment Variables
```env
MONGODB_URI=mongodb://localhost:27017/online-class-manager
JWT_SECRET=your-secret-key
REDIS_URL=redis://localhost:6379  # Optional for distributed locking
NODE_ENV=production|development
```

### Cron Schedule
- **Invoice Generation**: 1st of month at 00:05 UTC
- **Lock Cleanup**: Every 10 minutes

### Rate Partitions (Default)
- 0-50h: $12/hour
- 51-100h: $15/hour
- 101-200h: $18/hour
- 200+h: $20/hour

---

## 📡 API Endpoints

### Admin (requireAdmin)
- `POST /admin/generate` - Generate invoices
- `GET /admin/invoices` - List all invoices
- `GET /admin/invoices/:id` - Get invoice details
- `POST /admin/invoices/:id/publish` - Publish invoice
- `POST /admin/invoices/:id/unpublish` - Revert to draft
- `POST /admin/invoices/:id/mark-paid` - Record payment
- `POST /admin/invoices/:id/bonuses` - Add bonus
- `DELETE /admin/invoices/:id/bonuses/:bonusId` - Remove bonus
- `POST /admin/invoices/:id/extras` - Add extra charge
- `DELETE /admin/invoices/:id/extras/:extraId` - Remove extra
- `GET /admin/settings` - Get salary settings
- `PUT /admin/settings/partitions/:name` - Update rate partition
- `PUT /admin/settings/transfer-fee` - Update default fee
- `GET /admin/exchange-rates` - Get rates for year
- `POST /admin/exchange-rates` - Set monthly rate

### Teacher (requireTeacher)
- `GET /teacher/invoices` - Get own invoices
- `GET /teacher/ytd` - Get year-to-date summary

### Public
- `GET /shared/:token` - Access invoice via share link

---

## 💾 Database Collections

### Created Collections
- `teacherinvoices` - Teacher salary invoices
- `salarysettings` - Global salary configuration (singleton)
- `monthlyexchangerates` - Monthly USD→EGP rates
- `teachersalaryaudits` - Immutable audit trail
- `monthlyreports` - Cached performance reports

### Enhanced Collections
- `users` - Added teacherInfo salary fields

---

## 🔐 Security

### Authentication
- JWT token required for all endpoints (except public share links)
- Role-based access control (admin vs teacher)
- Teachers can only access their own data

### Audit Trail
- All operations logged in `teachersalaryaudits`
- Immutable logs (pre-save hook prevents modification)
- Tracks actor, timestamp, IP, user agent
- Before/after snapshots for all changes

### Data Immutability
- Published invoices cannot modify snapshots (rate, exchange, fee)
- Paid invoices cannot be deleted
- Audit logs cannot be modified
- Locked exchange rates cannot be changed

---

## 🧪 Testing

### Manual Testing Scripts
```bash
# Check system status
node scripts/checkSystemData.js

# Check exchange rates
node scripts/checkExchangeRates.js

# Test invoice generation
node scripts/testTeacherInvoiceGeneration.js <month> <year>
```

### Automated Testing (TODO)
- Unit tests: `test/models/*.test.js`
- Integration tests: `test/integration/*.test.js`
- E2E tests: `test/e2e/*.test.js`

---

## 📊 Invoice Lifecycle

```
1. Draft → 2. Published → 3. Paid → 4. Archived
   ↑            ↓
   └──────── Unpublish (before payment only)
```

### Status Transitions
- **Draft**: Editable, can modify hours/classes, no snapshots
- **Published**: Snapshots frozen (rate, exchange, fee), immutable
- **Paid**: Payment recorded, YTD updated, cannot unpublish
- **Archived**: Historical record, no modifications allowed

---

## 🔄 Monthly Workflow

### Automated (1st of each month at 00:05 UTC)
1. Cron job runs automatically
2. Validates exchange rate exists
3. Generates invoices for all active teachers
4. Creates in draft status
5. Notifies admins of completion

### Manual Admin Tasks
1. Review draft invoices
2. Add bonuses if needed
3. Publish invoices (freezes snapshots)
4. Send share links to teachers
5. Process payments
6. Mark invoices as paid

---

## 🐛 Troubleshooting

### No invoices generated
**Check:**
- Exchange rate set for month? `node scripts/checkExchangeRates.js`
- Active teachers exist? `node scripts/checkSystemData.js`
- Classes exist for month? Check MongoDB
- Auto-generation enabled? Check SalarySettings

### Wrong calculations
**Debug:**
- Get invoice: `GET /api/teacher-salary/admin/invoices/:id`
- Check `rateSnapshot`, `exchangeRateSnapshot`, `totalHours`
- Review audit logs: MongoDB → teachersalaryaudits

### Cron job not running
**Verify:**
- Check server logs: `[InvoiceGeneration] Job initialized`
- Manual trigger: `POST /api/teacher-salary/admin/generate`
- Test via script: `node scripts/testTeacherInvoiceGeneration.js`

---

## 📚 Documentation

### Complete Guides (in root directory)
- `TEACHER_SALARY_IMPLEMENTATION_STATUS.md` - What's built, what remains
- `TEACHER_SALARY_QUICK_START.md` - How to use the system
- `TEACHER_SALARY_REMAINING_WORK.md` - Roadmap for completion
- `TEACHER_SALARY_CHECKLIST.md` - Development task list
- `TEACHER_SALARY_REFERENCE_CARD.md` - Quick command reference

---

## 🎯 What's Next?

### Immediate (Frontend MVP)
1. Build admin invoice management UI
2. Build teacher dashboard UI
3. Implement PDF generation

### Soon
1. Settings management UI
2. Exchange rates UI
3. Reports and analytics

### Later
1. Guardian bonus integration
2. Comprehensive testing suite
3. Performance optimization

---

## 💡 Key Features

### Snapshots
- Rate, exchange rate, and transfer fee frozen at publish time
- Ensures historical accuracy
- Prevents retroactive changes

### YTD Tracking
- Year-to-date hours and earnings tracked per teacher
- Automatic rate tier progression
- Updated on payment recording

### Distributed Locking
- Redis-based lock prevents concurrent job execution
- Graceful fallback to in-memory if Redis unavailable
- Stale lock cleanup every 10 minutes

### Audit Compliance
- Complete audit trail for all operations
- Before/after snapshots
- Actor tracking (user, role, IP)
- Export to CSV for compliance

---

## 🔗 Dependencies

### Required
- Node.js 14+
- MongoDB 4.4+
- Express.js
- Mongoose
- dayjs
- node-cron
- bcryptjs
- jsonwebtoken

### Optional
- Redis (for distributed locking)

---

## 📞 Support

For questions or issues, refer to:
- Implementation status documentation
- Quick start guide
- API reference
- Troubleshooting section above

---

*Backend Version: 1.0*  
*Last Updated: January 2025*  
*Status: Production-ready for API/CLI usage*
