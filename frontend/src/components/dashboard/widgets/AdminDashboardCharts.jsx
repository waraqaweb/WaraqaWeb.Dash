import React from 'react';
import DashboardChartCard from './DashboardChartCard';
import { ResponsiveContainer } from 'recharts/es6/component/ResponsiveContainer';
import { Tooltip } from 'recharts/es6/component/Tooltip';
import { LineChart } from 'recharts/es6/chart/LineChart';
import { BarChart } from 'recharts/es6/chart/BarChart';
import { Line } from 'recharts/es6/cartesian/Line';
import { Bar } from 'recharts/es6/cartesian/Bar';
import { CartesianGrid } from 'recharts/es6/cartesian/CartesianGrid';
import { XAxis } from 'recharts/es6/cartesian/XAxis';
import { YAxis } from 'recharts/es6/cartesian/YAxis';

const EmptyChartState = ({ message }) => (
  <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">{message}</div>
);

const AdminDashboardCharts = ({ data }) => {
  const ts = data?.summary?.timeseries ?? data?.timeseries ?? null;
  const dates = (ts && ts.dates) ?? [];
  const revenue = (ts && ts.revenue) ?? [];
  const scheduled = (ts && ts.classesScheduled) ?? [];
  const completed = (ts && ts.classesCompleted) ?? [];

  const revenueChartData = dates.map((date, index) => ({
    date: date.slice(5),
    revenue: revenue[index] ?? 0,
  }));

  const classesChartData = dates.map((date, index) => ({
    date: date.slice(5),
    scheduled: scheduled[index] ?? 0,
    completed: completed[index] ?? 0,
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-foreground">Charts</div>
      <DashboardChartCard title="Revenue (30 days)" subtitle="Daily revenue">
        {revenueChartData.length === 0 ? (
          <EmptyChartState message="No revenue data" />
        ) : (
          <ResponsiveContainer height={110}>
            <LineChart data={revenueChartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip />
              <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </DashboardChartCard>
      <DashboardChartCard title="Classes (30 days)" subtitle="Scheduled vs completed">
        {classesChartData.length === 0 ? (
          <EmptyChartState message="No class data" />
        ) : (
          <ResponsiveContainer height={110}>
            <BarChart data={classesChartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="scheduled" fill="#10b981" />
              <Bar dataKey="completed" fill="#4f46e5" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </DashboardChartCard>
    </div>
  );
};

export default AdminDashboardCharts;