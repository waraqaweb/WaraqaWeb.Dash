import React, { useEffect, useState } from 'react';
import Toast from './Toast';

const ToastHost = () => {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      if (!detail?.message) return;
      setToast({
        message: detail.message,
        type: detail.type || 'info'
      });
    };

    window.addEventListener('app-toast', handler);
    return () => window.removeEventListener('app-toast', handler);
  }, []);

  if (!toast) return null;

  return (
    <Toast
      type={toast.type}
      message={toast.message}
      onClose={() => setToast(null)}
    />
  );
};

export default ToastHost;
