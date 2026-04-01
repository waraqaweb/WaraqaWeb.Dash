import React from 'react';

const DashboardChartCard = ({ title, children, subtitle }) => {
  return (
    <div className="bg-card rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h4 className="text-xs font-medium text-foreground">{title}</h4>
        </div>
      </div>
      <div className="w-full h-[100px]">
        {children}
      </div>
    </div>
  );
};

export default DashboardChartCard;
