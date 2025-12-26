import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { X, Download, MinusCircle, Save } from "lucide-react";
import LoadingSpinner from "../../../components/ui/LoadingSpinner";
import { useAuth } from "../../../contexts/AuthContext";
import { formatDateDDMMMYYYY } from '../../../utils/date';
import jsPDF from "jspdf";
import "jspdf-autotable";

const SalaryViewModal = ({ salaryData, onClose, refreshStats }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const handleClose = () => {
    if (onClose) return onClose();
    navigate(-1);
  };
  const [salary, setSalary] = useState(null);
  const [classes, setClasses] = useState([]);
  const [excludedClasses, setExcludedClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const salaryId = salaryData?._id;

  const formatDate = (d) => (d ? formatDateDDMMMYYYY(d) : "N/A");

  const fetchSalaryDetails = useCallback(async () => {
    if (!salaryId) return;
    try {
      setLoading(true);
  const { data: invRes } = await api.get(`/invoices/${salaryId}`);
      const inv = invRes.invoice || invRes;
      setSalary(inv);

      if (inv.billingPeriod?.startDate)
        setStartDate(new Date(inv.billingPeriod.startDate).toISOString().slice(0, 10));
      if (inv.billingPeriod?.endDate)
        setEndDate(new Date(inv.billingPeriod.endDate).toISOString().slice(0, 10));

      if (inv.billingPeriod?.startDate && inv.billingPeriod?.endDate) {
        const teacherId =
          typeof inv.teacher === "string" ? inv.teacher : inv.teacher?._id || null;

        if (teacherId) {
          const { data: classesRes } = await api.get(
            `/classes?teacherId=${teacherId}&from=${inv.billingPeriod.startDate}&to=${inv.billingPeriod.endDate}`
          );

          const filtered = (classesRes.classes || [])
            .filter((c) => {
              const dateObj = new Date(c.scheduledDate || c.date);
              const from = new Date(inv.billingPeriod.startDate);
              const to = new Date(inv.billingPeriod.endDate);

              return (
                dateObj >= from &&
                dateObj <= to &&
                ["attended", "absent"].includes(c.status)
              );
            })
            .map((c) => {
              const dateObj = new Date(c.scheduledDate || c.date);
              return {
                _id: c._id,
                studentName: c.student?.studentName || "-",
                subject: c.subject || "-",
                date: formatDateDDMMMYYYY(dateObj),
                rawDate: dateObj,
                time: dateObj.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                duration: c.duration || 0,
                status: c.status || "-",
              };
            });

          setClasses(filtered.sort((a, b) => a.rawDate - b.rawDate));
        }
      }
    } catch (err) {
      console.error("Salary fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [salaryId]);

  useEffect(() => {
    if (salaryId) {
      fetchSalaryDetails();
      setExcludedClasses(salaryData?.excludedClassIds || []);
    }
  }, [salaryId, salaryData?.excludedClassIds, fetchSalaryDetails]);
  

  if (loading) return <LoadingSpinner />;
  if (!salary) return <div className="p-4 text-center">Salary not found</div>;

  const activeClasses = classes.filter((c) => !excludedClasses.includes(c._id));
  const totalHours = activeClasses.reduce((sum, c) => sum + c.duration / 60, 0);
  const attendedCount = activeClasses.filter((c) => c.status === "attended").length;
  const absentCount = activeClasses.filter((c) => c.status === "absent").length;
  const totalClasses = activeClasses.length;

  const hourlyRate = salary.teacherPayment?.hourlyRate || 0;
  const totalUSD =
    totalHours * hourlyRate + (salary.bonus || 0) - (salary.deductions || 0);
  const totalEGP = salary.internalTotals?.exchangeRate
    ? totalUSD * salary.internalTotals.exchangeRate
    : salary.internalTotals?.totalEGP || 0;

  const handleToggleClass = (classId) => {
    setExcludedClasses((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        excludedClassIds: excludedClasses,
        billingPeriod: {
          startDate,
          endDate,
          year: new Date(startDate).getFullYear(),
          month: new Date(startDate).getMonth() + 1,
        },
      };

  const { data } = await api.put(`/invoices/${salary._id}`, payload);
      setSalary(data.invoice);

      // --- IMPORTANT: refresh stats after save
      if (refreshStats) await refreshStats();

      alert("Invoice saved successfully!");
    } catch (err) {
      console.error("[SalaryViewModal] Error saving invoice:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const doc = new jsPDF();
    const teacherName = `${salary.teacher?.firstName || ""}_${salary.teacher?.lastName || ""}`;
    const month = salary.billingPeriod?.startDate
      ? new Date(salary.billingPeriod.startDate).toLocaleString("default", {
          month: "long",
          year: "numeric",
        })
      : "Invoice";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Teacher Salary Invoice`, 14, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Teacher: ${salary.teacher?.firstName} ${salary.teacher?.lastName}`, 14, 30);
    doc.text(`Invoice #: ${salary.invoiceNumber || "N/A"}`, 14, 36);
    doc.text(
      `Billing Period: ${formatDate(salary.billingPeriod?.startDate)} → ${formatDate(
        salary.billingPeriod?.endDate
      )}`,
      14,
      42
    );
    doc.text(`Status: ${salary.status}`, 14, 48);
    doc.text(`Hourly Rate: $${hourlyRate.toFixed(2)}`, 14, 54);
    doc.text(`Bonus: $${salary.bonus || 0}`, 14, 60);
    doc.text(`Deductions: $${salary.deductions || 0}`, 14, 66);
    doc.text(`Total Hours: ${totalHours.toFixed(2)} h`, 14, 72);
    doc.text(`Total (USD): $${totalUSD.toFixed(2)}`, 14, 78);
    doc.text(`Total (EGP): ${totalEGP.toFixed(2)} EGP`, 14, 84);

    const tableData = activeClasses.map((c) => [
      c.date,
      c.time,
      c.studentName,
      c.subject,
      c.duration,
      c.status,
    ]);

    doc.autoTable({
      startY: 90,
      head: [["Date", "Time", "Student", "Subject", "Duration (mins)", "Status"]],
      body: tableData,
      theme: "grid",
      headStyles: {
        fillColor: [243, 244, 246],
        textColor: [55, 65, 81],
        fontStyle: "bold",
      },
      styles: { font: "helvetica", fontSize: 10 },
    });

    doc.save(`${teacherName}_${month}.pdf`);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-5xl p-6 relative overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-4 border-b pb-3 flex justify-between items-center">
          <h2 className="text-2xl font-bold">Teacher Salary Invoice</h2>
          <div className="flex gap-2">
            {user?.role === "admin" && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            )}
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 bg-custom-teal text-white px-3 py-1 rounded hover:bg-custom-teal-dark mr-16"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-6 mb-6 text-sm">
          <div className="space-y-2">
            <p>
              <strong>Teacher:</strong> {salary.teacher?.firstName}{" "}
              {salary.teacher?.lastName}
            </p>
            <p>
              <strong>Invoice #:</strong> {salary.invoiceNumber || "N/A"}
            </p>
            <p>
              <strong>Status:</strong> {salary.status}
            </p>
            <p>
              <strong>Billing Period:</strong>{" "}
              {user?.role === "admin" ? (
                <>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border rounded px-1"
                  />{" "}
                  →{" "}
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border rounded px-1"
                  />
                </>
              ) : (
                `${formatDate(salary.billingPeriod.startDate)} → ${formatDate(
                  salary.billingPeriod.endDate
                )}`
              )}
            </p>
          </div>

          {/* Hours & Classes */}
          <div className="space-y-2">
            <p>
              <strong>Total Hours:</strong> {totalHours.toFixed(2)} h
            </p>
            <p>
              <strong>Total Classes:</strong> {totalClasses}
            </p>
            <p>
              <strong>Attended:</strong> {attendedCount}
            </p>
            <p>
              <strong>Absent:</strong> {absentCount}
            </p>
          </div>

          {/* Payments */}
          <div className="space-y-2">
            <p>
              <strong>Hourly Rate:</strong> ${hourlyRate.toFixed(2)}
            </p>
            <p>
              <strong>Bonus:</strong> ${salary.bonus || 0}
            </p>
            <p>
              <strong>Deductions:</strong> ${salary.deductions || 0}
            </p>
            <p>
              <strong>Total (USD):</strong> ${totalUSD.toFixed(2)}
            </p>
            <p>
              <strong>Total (EGP):</strong> {totalEGP.toFixed(2)} EGP
            </p>
          </div>
        </div>

        {/* Classes Table */}
        <div>
          <h3 className="font-semibold mb-2 text-lg">Classes</h3>
          {classes.length === 0 ? (
            <p>No classes available for this period.</p>
          ) : (
            <div className="overflow-x-auto max-h-96 border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 border">Date</th>
                    <th className="p-2 border">Time</th>
                    <th className="p-2 border">Student</th>
                    <th className="p-2 border">Subject</th>
                    <th className="p-2 border">Duration (mins)</th>
                    <th className="p-2 border">Status</th>
                    {user?.role === "admin" && <th className="p-2 border">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr
                      key={c._id}
                      className={`even:bg-gray-50 ${
                        excludedClasses.includes(c._id) ? "opacity-50" : ""
                      }`}
                    >
                      <td className="p-2 border">{c.date}</td>
                      <td className="p-2 border">{c.time}</td>
                      <td className="p-2 border">{c.studentName}</td>
                      <td className="p-2 border">{c.subject}</td>
                      <td className="p-2 border">{c.duration}</td>
                      <td className="p-2 border">{c.status}</td>
                      {user?.role === "admin" && (
                        <td className="p-2 border text-center">
                          <button
                            onClick={() => handleToggleClass(c._id)}
                            className={`flex items-center gap-1 ${
                              excludedClasses.includes(c._id)
                                ? "text-green-600 hover:text-green-800"
                                : "text-red-600 hover:text-red-800"
                            }`}
                          >
                            <MinusCircle className="w-4 h-4" />
                            {excludedClasses.includes(c._id) ? "Undo" : "Subtract"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SalaryViewModal;
