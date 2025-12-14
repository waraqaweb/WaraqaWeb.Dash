import React from 'react';

const DashboardChartCard = ({ title, children, subtitle }) => {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        {children}
      </div>
    </div>
  );
};

export default DashboardChartCard;
