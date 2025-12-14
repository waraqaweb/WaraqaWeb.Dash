import React from 'react';

export default function ConfirmTransferModal({ open, onCancel, onConfirm, existingInvoiceNumber, existingInvoiceId }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <h2 className="text-lg font-semibold mb-2">Lesson already invoiced</h2>
        <p className="text-sm text-gray-700 mb-4">
          This lesson is already billed on invoice {existingInvoiceNumber || existingInvoiceId}. Do you want to transfer it to the current invoice?
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2C736C]"
            onClick={onConfirm}
          >
            Transfer here
          </button>
        </div>
      </div>
    </div>
  );
}
