// frontend/src/components/ui/Toast.jsx
import React, { useEffect } from "react";

const Toast = ({ type = 'success', message = '', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(), 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      role="alert"
      className={`fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ring-1 ring-black/5 transition-all duration-300 ${
        type === 'success' ? 'bg-emerald-600' : type === 'info' ? 'bg-[var(--primary)]' : type === 'warning' ? 'bg-amber-500' : 'bg-rose-600'
      }`}
    >
      <span>{message}</span>
    </div>
  );
};

export default Toast;
