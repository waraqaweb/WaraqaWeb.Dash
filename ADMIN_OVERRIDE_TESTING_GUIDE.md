# Admin Override System - Testing Guide

## Prerequisites

1. Backend server running (`node backend/server.js`)
2. Frontend dev server running (`npm start` in frontend/)
3. Admin account credentials
4. At least one teacher invoice in the system

## Test Scenarios

### Test 1: Basic Override Flow

**Steps:**

1. Log in as admin
2. Navigate to Teacher Salaries page
3. Click on any invoice to open detail modal
4. Verify you see an **Edit** button in the Financial Summary section header
5. Click **Edit** button
6. Verify:
   - Input fields appear for all amounts
   - **Cancel** and **Save** buttons appear
   - Hint text shows: "(Click values below to edit)"
7. Change one field (e.g., Net Amount from 2500.00 to 2600.00)
8. Click **Save**
9. Verify:
   - Modal shows loading state
   - Modal exits edit mode
   - New value displays (2600.00)
   - No errors in console

**Expected Result:** ✅ Override saved successfully, value updated

---

### Test 2: Multiple Field Edits

**Steps:**

1. Open any invoice detail
2. Click **Edit**
3. Modify multiple fields:
   - Exchange Rate: 50.00 → 52.00
   - Bonuses (EGP): 100.00 → 150.00
   - Net Amount: 2500.00 → 2700.00
4. Click **Save**
5. Verify all three values updated correctly

**Expected Result:** ✅ All modifications saved

---

### Test 3: Cancel Functionality

**Steps:**

1. Open invoice detail
2. Click **Edit**
3. Change several fields
4. Click **Cancel** (don't save)
5. Verify:
   - Edit mode exits
   - Original values still displayed
   - No changes persisted

**Expected Result:** ✅ Changes discarded, original values remain

---

### Test 4: Adjustment History Display

**Steps:**

1. Open an invoice that has been overridden (from Test 1 or 2)
2. Scroll to bottom of modal
3. Verify **Adjustment History** section appears
4. Check history entry shows:
   - Admin name who made change
   - Date/time of change
   - List of changed fields
   - Old value → New value for each field
   - Values formatted correctly (2 decimals)

**Expected Result:** ✅ Complete audit trail visible

---

### Test 5: Multiple Override Sessions

**Steps:**

1. Open invoice, override Net Amount to 2600.00, save
2. Close and reopen same invoice
3. Override Net Amount again to 2800.00, save
4. Check Adjustment History
5. Verify:
   - Two separate history entries
   - Most recent at top
   - First entry: X → 2600.00
   - Second entry: 2600.00 → 2800.00

**Expected Result:** ✅ Multiple overrides tracked correctly

---

### Test 6: Teacher Role Access Control

**Steps:**

1. Log out from admin account
2. Log in as teacher
3. Navigate to view your own invoice
4. Verify:
   - No **Edit** button visible
   - All values shown as read-only text
   - No adjustment history section

**Expected Result:** ✅ Teachers cannot edit or see admin overrides

---

### Test 7: Persistence Across Refresh

**Steps:**

1. Log in as admin
2. Override an invoice's Net Amount to 3000.00
3. Close modal
4. Refresh entire page
5. Reopen same invoice
6. Verify Net Amount still shows 3000.00

**Expected Result:** ✅ Override persists in database

---

### Test 8: Edit All Fields

**Steps:**

1. Open invoice detail as admin
2. Click **Edit**
3. Modify every editable field:
   - Base Salary (USD)
   - Converted to EGP
   - Exchange Rate
   - Bonuses (EGP)
   - Extras (EGP)
   - Subtotal (EGP)
   - Transfer Fee (EGP)
   - Net Amount (EGP)
4. Click **Save**
5. Verify all 8 fields updated
6. Check Adjustment History shows all 8 changes

**Expected Result:** ✅ All fields independently editable

---

### Test 9: Input Validation

**Steps:**

1. Open invoice, click **Edit**
2. Try entering invalid values:
   - Negative number: `-100`
   - Non-numeric text: `abc`
   - Very large number: `999999999`
3. Click **Save**
4. Check behavior

**Expected Result:**

- Backend accepts numeric values (including large numbers)
- Non-numeric values may cause validation error
- _Note: Currently basic validation, can enhance_

---

### Test 10: Empty/Null Values

**Steps:**

1. Open invoice with overrides
2. Click **Edit**
3. Clear a field (delete all text)
4. Click **Save**
5. Verify:
   - System accepts empty value
   - Field reverts to calculated value OR
   - Field shows as null

**Expected Result:** ✅ System handles empty values gracefully

---

## API Testing (Optional)

### Direct API Call Test

**Endpoint:** `POST /api/teacher-salary/admin/invoices/:id/overrides`

**Request Body:**

```json
{
  "overrides": {
    "netAmountEGP": 2750.5,
    "exchangeRate": 51.25
  }
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Overrides applied successfully",
  "invoice": {
    /* updated invoice object */
  }
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/teacher-salary/admin/invoices/INVOICE_ID/overrides \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overrides":{"netAmountEGP":2750.50}}'
```

---

## Browser Console Checks

While testing, monitor browser console for:

### Success Messages:

- No errors when saving overrides
- Successful API responses (200 status)

### Network Tab:

- POST request to `/admin/invoices/:id/overrides`
- Response includes updated invoice
- GET request to refresh invoice after save

### React DevTools:

- `editMode` state toggles correctly
- `editedValues` updates as you type
- `saving` state true during save operation

---

## Known Issues / Edge Cases

1. **Decimal Precision**: Values auto-format to 2 decimals
2. **Concurrent Edits**: Two admins editing same invoice simultaneously - last save wins
3. **Calculation Mismatch**: If manual override creates mathematically incorrect totals (e.g., subtotal ≠ sum of parts), system accepts it (by design for flexibility)

---

## Troubleshooting

### Edit button not appearing

- ✓ Verify logged in as admin (`user.role === 'admin'`)
- ✓ Check browser console for errors
- ✓ Verify component received user from AuthContext

### Save fails with 400 error

- ✓ Check network tab for error message
- ✓ Verify overrides object structure
- ✓ Ensure admin token valid

### Changes not persisting

- ✓ Check backend console for save errors
- ✓ Verify MongoDB connection
- ✓ Check invoice document for `overrides` field

### Adjustment history not showing

- ✓ Verify `changeHistory` populated in response
- ✓ Check filter: `action === 'override_amounts'`
- ✓ Ensure at least one override saved

---

## Success Criteria

✅ All 10 test scenarios pass  
✅ No console errors  
✅ Audit trail complete  
✅ Role-based access working  
✅ Values persist across sessions

## Performance Notes

- Override save typically completes in < 500ms
- Invoice refresh after save adds ~200ms
- History display renders instantly (frontend filtering)
- No noticeable UI lag during edit mode

---

## Next Steps After Testing

1. ✅ Mark any bugs found
2. ✅ Test with real production data
3. ✅ Add visual indicators for overridden fields (future enhancement)
4. ✅ Consider adding revert functionality
5. ✅ Document for end users
