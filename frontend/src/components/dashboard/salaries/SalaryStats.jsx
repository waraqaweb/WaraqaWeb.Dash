// /frontend/src/components/dashboard/salaries/SalaryStats.jsx
import React from "react";
import { BarChart2, DollarSign, CheckCircle, AlertCircle } from "lucide-react";

const SalaryStats = ({ stats }) => {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white shadow rounded p-4 flex items-center gap-3">
        <BarChart2 className="w-6 h-6 text-blue-600" />
        <div>
          <p className="text-sm text-gray-500">Total Salaries</p>
          <p className="text-lg font-bold">{stats.totalInvoices ?? 0}</p>
        </div>
      </div>
      <div className="bg-white shadow rounded p-4 flex items-center gap-3">
        <CheckCircle className="w-6 h-6 text-green-600" />
        <div>
          <p className="text-sm text-gray-500">Paid</p>
          <p className="text-lg font-bold">{stats.paidCount ?? 0}</p>
        </div>
      </div>
      <div className="bg-white shadow rounded p-4 flex items-center gap-3">
        <AlertCircle className="w-6 h-6 text-yellow-600" />
        <div>
          <p className="text-sm text-gray-500">Unpaid</p>
          <p className="text-lg font-bold">{stats.unpaidCount ?? 0}</p>
        </div>
      </div>
      <div className="bg-white shadow rounded p-4 flex items-center gap-3">
        <DollarSign className="w-6 h-6 text-purple-600" />
        <div>
          <p className="text-sm text-gray-500">Total USD</p>
          <p className="text-lg font-bold">
            ${Number(stats.totalAmountUsd || 0).toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SalaryStats;
