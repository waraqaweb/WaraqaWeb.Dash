import React, { useState, useEffect } from "react";
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { X, Plus } from "lucide-react";

const SalaryCreateModal = ({ onClose, onCreated }) => {
  const navigate = useNavigate();
  const handleClose = () => {
    if (onClose) return onClose();
    navigate(-1);
  };
  const [teachers, setTeachers] = useState([]);

  const getDefaultDueDate = () => {
    const today = new Date();
    const currentMonth5th = new Date(today.getFullYear(), today.getMonth(), 5);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return today.getDate() < 5
      ? currentMonth5th.toISOString().split("T")[0]
      : tomorrow.toISOString().split("T")[0];
  };

  const [form, setForm] = useState({
    teacherId: "",
    dueDate: getDefaultDueDate(),
    exchangeRate: "",
    notes: "",
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split("T")[0],
    endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      .toISOString()
      .split("T")[0],
  });

  useEffect(() => {
    fetchTeachers();
  }, []);

  const fetchTeachers = async () => {
    try {
      const res = await api.get("/users", { params: { role: "teacher" } });
      setTeachers(res.data.users || []);
    } catch (err) {
      console.error("Error fetching teachers:", err.response?.data || err);
      alert("Failed to load teachers. Make sure you are logged in as admin.");
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCreate = async () => {
    if (!form.teacherId || !form.dueDate || !form.exchangeRate) {
      return alert("Please fill all required fields.");
    }

    const token = localStorage.getItem("token");
    try {
      const res = await api.post("/invoices/teacherInvoices", {
        teacherId: form.teacherId,
        exchangeRate: Number(form.exchangeRate),
        dueDate: form.dueDate,
        notes: form.notes,
        billingPeriod: {
          startDate: form.startDate,
          endDate: form.endDate,
        },
      });
     
      console.log("Salary created successfully:", res.data);
      onCreated();
      onClose();
    } catch (err) {
      console.error("Error creating salary:", err.response?.data || err);
      alert(err.response?.data?.message || "Failed to create salary.");
    }
  };

  const handleGenerateMonth = async () => {
    if (!window.confirm("Generate salaries for all teachers this month?")) return;

    const token = localStorage.getItem("token");
    try {
      const res = await api.post("/invoices/teacherInvoices/generate", {
        exchangeRate: Number(form.exchangeRate) || 1,
        dueDate: form.dueDate,
        notes: form.notes,
        billingPeriod: {
          startDate: form.startDate,
          endDate: form.endDate,
        },
      });
      console.log("Monthly salaries generated:", res.data);
      onCreated();
      onClose();
    } catch (err) {
      console.error("Error generating monthly salaries:", err.response?.data || err);
      alert("Failed to generate monthly salaries.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg rounded-lg shadow-lg p-6 relative">
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-4">Create Salary</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Teacher</label>
            <select
              name="teacherId"
              value={form.teacherId}
              onChange={handleChange}
              className="border rounded px-2 py-1 w-full"
            >
              <option value="">-- Select Teacher --</option>
              {teachers.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">Start Date</label>
            <input
              type="date"
              name="startDate"
              value={form.startDate}
              onChange={handleChange}
              className="border rounded px-2 py-1 w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">End Date</label>
            <input
              type="date"
              name="endDate"
              value={form.endDate}
              onChange={handleChange}
              className="border rounded px-2 py-1 w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Due Date</label>
            <input
              type="date"
              name="dueDate"
              value={form.dueDate}
              onChange={handleChange}
              className="border rounded px-2 py-1 w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Exchange Rate</label>
            <input
              type="number"
              name="exchangeRate"
              value={form.exchangeRate}
              onChange={handleChange}
              className="border rounded px-2 py-1 w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              className="border rounded px-2 py-1 w-full"
            />
          </div>
        </div>

        <div className="flex justify-between mt-6">
          <button
            onClick={handleGenerateMonth}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded"
          >
            Generate for Month
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="border px-4 py-2 rounded text-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="bg-custom-teal hover:bg-custom-teal-dark text-white px-4 py-2 rounded flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalaryCreateModal;
