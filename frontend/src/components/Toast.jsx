import { useEffect } from 'react';

// Auto-dismissing success/error banner.
export default function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className={`toast toast--${toast.type}`} role="status">
      <span>{toast.message}</span>
      <button className="toast__close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
