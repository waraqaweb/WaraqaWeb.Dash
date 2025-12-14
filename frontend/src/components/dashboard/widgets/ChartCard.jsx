import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

// Clean, light color palette to match StatCard tone
const COLORS = {
  line: '#4f46e5', // indigo-600
  lineFill: 'rgba(79,70,229,0.08)',
  bar: '#06b6d4', // teal-400
  grid: '#e6e7eb',
  axis: '#6b7280', // gray-500
};

const ChartCard = ({ title, subtitle, type = 'line', data = [] }) => {
  const formattedData = Array.isArray(data) ? data : [];

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      </div>

      <div style={{ width: '100%', height: 170 }}>
        <ResponsiveContainer>
          {type === 'line' ? (
            <LineChart data={formattedData} margin={{ top: 6, right: 8, left: 0, bottom: 6 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: COLORS.axis }} />
              <YAxis tick={{ fontSize: 12, fill: COLORS.axis }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e6e7eb' }}
                itemStyle={{ color: COLORS.line }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={COLORS.line}
                strokeWidth={2}
                dot={{ r: 3, stroke: COLORS.line, strokeWidth: 1 }}
                activeDot={{ r: 5 }}
                fill={COLORS.lineFill}
              />
            </LineChart>
          ) : (
            <BarChart data={formattedData} margin={{ top: 6, right: 8, left: 0, bottom: 6 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: COLORS.axis }} />
              <YAxis tick={{ fontSize: 12, fill: COLORS.axis }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e6e7eb' }}
                itemStyle={{ color: COLORS.bar }}
              />
              <Bar dataKey="value" fill={COLORS.bar} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ChartCard;
