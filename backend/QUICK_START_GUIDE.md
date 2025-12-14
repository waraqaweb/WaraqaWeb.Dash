# Teacher Salary System - Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### 1. Start Backend

```bash
cd backend
npm install
node server.js
```

**Backend running at:** `http://localhost:5000`

### 2. Start Frontend

```bash
cd frontend
npm install
npm start
```

**Frontend running at:** `http://localhost:3000`

---

## 📋 Quick Command Reference

### Run All Tests

```bash
# Module 1: Database Models
node testTeacherSalaryModels.js

# Module 2: Service Layer
node testModule2Services.js

# Module 3: Automated Jobs
node testModule3Jobs.js

# Module 4: API Routes
node testModule4Routes.js
```

### Manual Invoice Generation

```bash
# Using curl (admin token required)
curl -X POST http://localhost:5000/api/teacher-salary/admin/generate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"month": 11, "year": 2025, "dryRun": false}'
```

---

## 🔑 Key Endpoints

### Teacher Endpoints

```javascript
// Get YTD summary
GET /api/teacher-salary/teacher/ytd?year=2025

// Get own invoices
GET /api/teacher-salary/teacher/invoices?page=1&limit=10

// Download PDF
GET /api/teacher-salary/teacher/invoices/:id/pdf
```

### Admin Endpoints

```javascript
// Generate invoices
POST /api/teacher-salary/admin/generate
Body: { month: 11, year: 2025, dryRun: false }

// List all invoices
GET /api/teacher-salary/admin/invoices?status=draft&page=1

// Publish invoice
POST /api/teacher-salary/admin/invoices/:id/publish

// Mark as paid
POST /api/teacher-salary/admin/invoices/:id/mark-paid
Body: { 
  paymentMethod: "wise",
  transactionId: "TXN-123",
  note: "Payment processed"
}
```

---

## 📊 Rate Partitions

```
0-50h       → $12/hour  (Beginner)
51-100h     → $15/hour  (Intermediate)
101-200h    → $18/hour  (Advanced)
200+h       → $20/hour  (Expert)
```

---

## 🗂️ Key Files

### Backend
```
backend/
├── models/
│   ├── TeacherInvoice.js          # Invoice model
│   ├── SalarySettings.js          # Settings model
│   └── User.js                    # User with teacher fields
├── services/
│   ├── teacherSalaryService.js    # Core business logic
│   └── teacherInvoicePDFService.js # PDF generation
├── routes/
│   └── teacherSalary.js           # API routes
└── jobs/
    └── generateTeacherInvoicesJob.js # Automated job
```

### Frontend
```
frontend/src/
├── pages/
│   ├── teacher/
│   │   └── SalaryDashboard.jsx    # Teacher dashboard
│   └── admin/
│       └── teacherSalary/
│           └── TeacherInvoices.jsx # Admin interface
└── components/
    └── teacherSalary/
        └── TeacherInvoiceDetailModal.jsx # Detail modal
```

---

## 🧪 Test Status

```
✅ Module 1: 6/6 tests passing   (100%)
✅ Module 2: 4/4 tests passing   (100%)
✅ Module 3: 6/6 tests passing   (100%)
✅ Module 4: 14/14 tests passing (100%)
─────────────────────────────────────
✅ TOTAL: 30/30 tests passing    (100%)
```

---

## 📝 Environment Variables

### Backend (.env)
```bash
MONGODB_URI=mongodb://localhost:27017/waraqa
JWT_SECRET=your-secret-key
REDIS_URL=redis://localhost:6379
PORT=5000
```

### Frontend (.env)
```bash
REACT_APP_API_URL=http://localhost:5000/api
```

---

## 🔄 Invoice Lifecycle

```
1. DRAFT       → Created by automated job or admin
                 ↓
2. PUBLISHED   → Made visible to teacher
                 ↓
3. PAID        → Payment processed and recorded
```

---

## 💡 Common Operations

### Add Bonus to Invoice

```javascript
POST /api/teacher-salary/admin/invoices/:id/bonuses
{
  "source": "referral",
  "amountUSD": 50.00,
  "reason": "Student referral bonus"
}
```

### Add Extra to Invoice

```javascript
POST /api/teacher-salary/admin/invoices/:id/extras
{
  "category": "transportation",
  "amountUSD": 25.00,
  "reason": "Travel reimbursement"
}
```

### Set Exchange Rate

```javascript
POST /api/teacher-salary/admin/exchange-rates
{
  "month": 12,
  "year": 2025,
  "rate": 51.50,
  "source": "Central Bank"
}
```

---

## 🎯 Quick Troubleshooting

### Backend won't start
```bash
# Check MongoDB is running
mongosh

# Check Redis is running (optional)
redis-cli ping
```

### Frontend won't start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Tests failing
```bash
# Ensure test database is empty
mongosh waraqa_test --eval "db.dropDatabase()"
```

---

## 📚 Documentation

- **Complete System:** `TEACHER_SALARY_SYSTEM_COMPLETE.md`
- **Module 1:** `MODULE_1_IMPLEMENTATION_COMPLETE.md`
- **Module 2:** `MODULE_2_IMPLEMENTATION_COMPLETE.md`
- **Module 3:** `MODULE_3_IMPLEMENTATION_COMPLETE.md`
- **Module 4:** `MODULE_4_IMPLEMENTATION_COMPLETE.md`
- **Module 5:** `MODULE_5_IMPLEMENTATION_COMPLETE.md`

---

## 🆘 Need Help?

1. Check the detailed module documentation
2. Review test files for usage examples
3. Inspect API responses in browser dev tools
4. Check backend console logs

---

**Status:** ✅ PRODUCTION READY  
**Version:** 1.0  
**Last Updated:** November 2025
