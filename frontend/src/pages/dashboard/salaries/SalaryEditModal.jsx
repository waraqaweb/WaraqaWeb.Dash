// /frontend/src/components/dashboard/salaries/SalaryEditModal.jsx
import React, { useState } from "react";
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { X, Save } from "lucide-react";

const SalaryEditModal = ({ salary, onClose, onUpdated }) => {
  const navigate = useNavigate();
  const handleClose = () => {
    if (onClose) return onClose();
    navigate(-1);
  };
  const [form, setForm] = useState({
    bonus: salary.teacherPayment?.bonus || 0,
    bonusReason: salary.teacherPayment?.bonusReason || "",
    deductions: salary.teacherPayment?.deductions || 0,
    deductionReason: salary.teacherPayment?.deductionReason || "",
    exchangeRate: salary.exchangeRate || "",
    status: salary.status || "draft",
    dueDate: salary.dueDate ? salary.dueDate.substring(0, 10) : "",
    notes: salary.notes || "",
    billingStart: salary.billingPeriod?.startDate?.substring(0, 10) || "",
    billingEnd: salary.billingPeriod?.endDate?.substring(0, 10) || ""
  });
  
  const [, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSave = async () => {
    if (!window.confirm("Are you sure you want to update this salary?")) return;
    try {
      setLoading(true);
      await api.put(`/invoices/${salary._id}`, {
        teacherPayment: {
          bonus: Number(form.bonus || 0),
          bonusReason: form.bonusReason,
          deductions: Number(form.deductions || 0),
          deductionReason: form.deductionReason
        },
        exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : undefined,
        status: form.status,
        dueDate: form.dueDate || undefined,
        notes: form.notes,
        billingPeriod: {
          startDate: form.billingStart || undefined,
          endDate: form.billingEnd || undefined,
          month: form.billingStart ? new Date(form.billingStart).getMonth() + 1 : undefined,
          year: form.billingStart ? new Date(form.billingStart).getFullYear() : undefined
        }
      });
      
      onUpdated && onUpdated();
      onClose();
    } catch (err) {
      console.error("Error updating salary:", err);
      alert(err.response?.data?.message || "Failed to update salary.");
    } finally {
      setLoading(false);
    }
  };

  const handleProcessPayment = async () => {
    if (!window.confirm("Mark this salary as paid?")) return;
    try {
      setLoading(true);
      await api.post(`/invoices/${salary._id}/process-payment`, { amount: form.amount });
      onUpdated && onUpdated();
      onClose();
    } catch (err) {
      console.error("Error processing payment:", err);
      alert(err.response?.data?.message || "Failed to process payment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-2xl rounded-lg shadow-lg p-6 relative">
        <button onClick={handleClose} className="absolute top-3 right-3 text-gray-500 hover:text-gray-700">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-4">Edit Salary – {salary.teacher?.firstName} {salary.teacher?.lastName}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Bonus (USD)</label>
            <input type="number" name="bonus" value={form.bonus} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Bonus Reason</label>
            <input type="text" name="bonusReason" value={form.bonusReason} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Deductions (USD)</label>
            <input type="number" name="deductions" value={form.deductions} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Deduction Reason</label>
            <input type="text" name="deductionReason" value={form.deductionReason} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Exchange Rate</label>
            <input type="number" name="exchangeRate" value={form.exchangeRate} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Status</label>
            <select name="status" value={form.status} onChange={handleChange} className="border rounded px-2 py-1 w-full">
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {/* Invoice Number (read-only) */}
          <div>
            <label className="block text-sm font-medium">Invoice #</label>
            <input type="text" value={salary.invoiceNumber || ""} disabled className="border rounded px-2 py-1 w-full bg-gray-100" />
          </div>

          {/* Billing Period */}
          <div>
            <label className="block text-sm font-medium">Billing Start</label>
            <input type="date" name="billingStart" value={form.billingStart} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Billing End</label>
            <input type="date" name="billingEnd" value={form.billingEnd} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium">Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} className="border rounded px-2 py-1 w-full" />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={handleProcessPayment} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">Mark as Paid</button>
          <button onClick={handleSave} className="bg-custom-teal hover:bg-custom-teal-dark text-white px-4 py-2 rounded flex items-center gap-2">
            <Save className="w-4 h-4" /> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default SalaryEditModal;
