import React from 'react';

const FirstClassReminder = ({ items = [], onOpen }) => {
  if (!items || items.length === 0) return null;

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-2">First-class reminders</h3>
      <div className="space-y-2">
        {items.slice(0, 6).map((c) => (
          <div key={c._id || c.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted transition-colors">
            <div>
              <div className="text-sm font-medium">{c.student?.studentName || (c.student && `${c.student.firstName || ''} ${c.student.lastName || ''}`) || 'Student'}</div>
              <div className="text-xs text-muted-foreground">{new Date(c.scheduledDate).toLocaleString()}</div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                className="px-3 py-1 rounded bg-primary text-white text-sm"
                onClick={() => onOpen && onOpen(c)}
              >
                Open
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FirstClassReminder;
