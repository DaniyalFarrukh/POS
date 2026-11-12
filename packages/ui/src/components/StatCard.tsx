import React from 'react';
import { cn } from '../lib/utils';
import { Card, CardContent } from './Card';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  trend?: {
    value: string;
    isPositive?: boolean;
  };
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  badge,
  trend,
  className,
}) => {
  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow',
        className
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
          {icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#2F64D8]">
              {icon}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 font-mono">{value}</h3>
          {badge}
        </div>
        {(subtitle || trend) && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            {trend && (
              <span
                className={cn(
                  'font-semibold',
                  trend.isPositive ? 'text-emerald-600' : 'text-rose-600'
                )}
              >
                {trend.isPositive ? '↑' : '↓'} {trend.value}
              </span>
            )}
            {subtitle && <span className="text-slate-500">{subtitle}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
