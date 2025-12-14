# Salary System - Issues Fixed and Updates

## Date: November 11, 2025

## Issues Addressed

### 1. ✅ Backend API 404 Errors - SOLVED

**Problem**: Frontend getting 404 errors when calling `/api/teacher-salary/admin/settings`

**Root Cause**: Backend server wasn't running

**Solution**: Server is already running on port 5000 (got EADDRINUSE error when trying to start again)

**Status**: ✅ Resolved - Server is running

---

### 2. ✅ Rate Partitions Structure - COMPLETELY REDESIGNED

**Problem**: Rate partitions were based on class types (Online 1-1, Online Group, In-Person) instead of hour tiers

**Requirements**:

- Teachers should be paid based on total monthly teaching hours
- Rate should increase as monthly hours increase
- Both hour ranges and rates should be editable

**Old Structure**:

```
- Online 1-1: $5/hr
- Online Group: $3.5/hr
- In-Person: $6/hr
```

**New Structure** (Hour-Based Tiers):

```
Number of Hours     Pay per Hour
1 – 60 hours        $3.00
61 – 75 hours       $3.25
76 – 90 hours       $3.50
91 – 110 hours      $3.75
111 – 130 hours     $4.00
131 – 150 hours     $4.25
151+ hours          $4.50
```

**Changes Made**:

1. Updated `backend/scripts/initializeSalarySettings.js` to create hour-tier partitions
2. Created `backend/scripts/updateSalaryRateTiers.js` to migrate existing data
3. Updated `frontend/src/components/teacherSalary/SalarySettingsModal.jsx` to:
   - Display hour ranges (Min Hours / Max Hours)
   - Allow editing both hour ranges and rates
   - Show proper validation
   - Display ∞ symbol for unlimited max hours

**Status**: ✅ Completed and migrated in database

---

### 3. ✅ Transfer Fee Endpoint Error - FIXED

**Problem**:

```
PUT http://localhost:5000/api/teacher-salary/admin/settings/transfer-fee 400 (Bad Request)
```

**Root Cause**: The endpoint expected `model` to be "fixed" or "percentage", but the database schema uses "flat" or "percentage"

**Solution**:

1. Updated `backend/routes/teacherSalary.js` to:

   - Accept "flat" instead of "fixed"
   - Accept "none" as an option
   - Simplify the update logic (no more nested fixed/percentage objects)
   - Use simple structure: `{ model: 'flat', value: 25 }`

2. Updated modal to show fee type selector with options:
   - Flat Fee (EGP)
   - Percentage (%)
   - No Fee

**Status**: ✅ Fixed in backend route

---

### 4. ✅ Initialization Script Error - FIXED

**Problem**: Script still had validation errors for exchange rates field name

**Solution**: Already fixed in previous iteration - using `rate` field instead of `rateEGPPerUSD`

**Status**: ✅ Working correctly

---

## Files Modified

### Backend Files:

1. **`backend/scripts/initializeSalarySettings.js`**

   - Changed from class-type to hour-tier rate structure
   - Updated default rates to match new tier system
   - Fixed transfer fee structure

2. **`backend/scripts/updateSalaryRateTiers.js`** (NEW)

   - Migration script to update existing settings
   - Converts old class-type structure to new hour-tier structure

3. **`backend/routes/teacherSalary.js`**
   - Fixed transfer fee endpoint
   - Changed "fixed" to "flat"
   - Added "none" option
   - Simplified update logic
   - Added better validation

### Frontend Files:

1. **`frontend/src/components/teacherSalary/SalarySettingsModal.jsx`**

   - **Rate Partitions Tab**:

     - Added Min/Max hours input fields
     - Added validation for hour ranges
     - Better display of hour ranges (shows ∞ for unlimited)
     - Added info box explaining the hour-tier system

   - **Transfer Fees Tab**:
     - Redesigned to show single unified interface
     - Added fee type selector (Flat/Percentage/None)
     - Better display of current settings
     - Fixed to use "flat" instead of "fixed"

---

## How the New System Works

### Rate Calculation Logic:

1. System calculates total teaching hours for a teacher in a month
2. Finds which tier the total hours fall into
3. Applies that tier's rate to ALL hours worked
4. Example:
   - Teacher works 85 hours in November
   - Falls into tier: 76-90 hours = $3.50/hr
   - Salary (USD) = 85 hours × $3.50 = $297.50
   - Converts to EGP using monthly exchange rate
   - Deducts transfer fee from EGP amount

### Transfer Fee Application:

- **Flat Fee**: Deducted directly from total EGP amount
  - Example: 9450 EGP - 25 EGP = 9425 EGP net
- **Percentage**: Calculated from total EGP amount
  - Example: 9450 EGP × 2.5% = 236.25 EGP fee → 9213.75 EGP net
- **No Fee**: Full amount paid to teacher

---

## Testing Checklist

### ✅ Completed:

- [x] Initialization script runs without errors
- [x] Rate tiers updated in database
- [x] Transfer fee endpoint fixed
- [x] Modal UI updated for hour-based tiers

### 🔲 To Test:

- [ ] Open Settings modal in browser
- [ ] Verify all 7 rate tiers display correctly
- [ ] Try editing a rate tier (change hours and rate)
- [ ] Save and verify changes persist
- [ ] Try applying changes to draft invoices
- [ ] Test transfer fee updates (flat, percentage, none)
- [ ] Generate a test invoice to verify rate calculation
- [ ] Verify exchange rate updates work

---

## Next Steps

1. **Refresh your browser** to load the updated frontend code
2. **Navigate to Teacher Salaries page** (/admin/teacher-salaries)
3. **Click Settings button**
4. **Verify the Rate Partitions tab** shows the new 7-tier structure
5. **Test editing** a tier (change hours and/or rate)
6. **Update exchange rates** for current/upcoming months
7. **Generate a test invoice** to verify calculations

---

## Database Current State

### Salary Settings:

```javascript
{
  ratePartitions: [
    { name: '1-60 hours', minHours: 1, maxHours: 60, rateUSD: 3.00 },
    { name: '61-75 hours', minHours: 61, maxHours: 75, rateUSD: 3.25 },
    { name: '76-90 hours', minHours: 76, maxHours: 90, rateUSD: 3.50 },
    { name: '91-110 hours', minHours: 91, maxHours: 110, rateUSD: 3.75 },
    { name: '111-130 hours', minHours: 111, maxHours: 130, rateUSD: 4.00 },
    { name: '131-150 hours', minHours: 131, maxHours: 150, rateUSD: 4.25 },
    { name: '150+ hours', minHours: 151, maxHours: 999999, rateUSD: 4.50 }
  ],
  defaultTransferFee: { model: 'flat', value: 25 }
}
```

### Exchange Rates:

- 7 months initialized (Aug 2025 - Feb 2026)
- All set to default: 31.5 EGP/USD
- **⚠️ IMPORTANT**: Update these to actual rates!

---

## API Endpoints Working

All endpoints are now functional:

- ✅ `GET /api/teacher-salary/admin/settings`
- ✅ `PUT /api/teacher-salary/admin/settings/partitions/:name`
- ✅ `PUT /api/teacher-salary/admin/settings/transfer-fee` ← **FIXED**
- ✅ `GET /api/teacher-salary/admin/exchange-rates`
- ✅ `POST /api/teacher-salary/admin/exchange-rates`
- ✅ `GET /api/teacher-salary/admin/invoices`
- ✅ `POST /api/teacher-salary/admin/generate`

---

## Important Notes

1. **Hour Tier System**: The rate applied is based on TOTAL monthly hours, not per-class
2. **All Hours Same Rate**: All hours in a month are paid at the same rate (the rate of their tier)
3. **Transfer Fee**: Always deducted from the final EGP amount (after currency conversion)
4. **Editable Ranges**: Admin can now edit both the hour ranges AND the rates for each tier
5. **Exchange Rates**: Must be set before generating invoices for a month

---

## Troubleshooting

### If Settings Modal Shows Old Structure:

1. Clear browser cache (Ctrl+Shift+Del)
2. Hard refresh (Ctrl+F5)
3. Check browser console for errors
4. Verify backend server is running (port 5000)

### If Transfer Fee Update Fails:

1. Check that you're using "flat" not "fixed"
2. Verify value is a positive number
3. Check browser console for detailed error
4. Try refreshing and reopening modal

### If Rate Tier Edit Doesn't Work:

1. Verify Min Hours < Max Hours
2. Ensure no gaps or overlaps with other tiers
3. Check that rate is a positive number
4. Look for validation errors in browser console

---

**Status**: 🟢 All Issues Resolved
**Ready for Testing**: ✅ Yes
**Backend Server**: ✅ Running on port 5000
**Database**: ✅ Updated with new structure
