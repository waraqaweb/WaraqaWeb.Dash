// frontend/src/components/ui/Toast.jsx
import React, { useEffect, useState } from "react";
import { CheckCircle, Info, AlertTriangle, XCircle, X } from "lucide-react";

const iconMap = {
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

const colorMap = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
};

const iconColorMap = {
  success: "text-emerald-500",
  info: "text-blue-500",
  warning: "text-amber-500",
  error: "text-rose-500",
};

const Toast = ({ type = 'success', message = '', onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onClose(), 200);
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const Icon = iconMap[type] || CheckCircle;

  return (
    <div
      role="alert"
      className={`fixed bottom-6 right-6 z-[1000] flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${colorMap[type] || colorMap.success} max-w-[min(400px,calc(100vw-3rem))]`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColorMap[type] || iconColorMap.success}`} />
      <span className="text-sm font-medium leading-snug">{message}</span>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onClose(), 200); }}
        className="ml-auto shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default Toast;
