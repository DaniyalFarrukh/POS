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
    <Card className={cn('relative overflow-hidden', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          {icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              {icon}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{value}</h3>
          {badge}
        </div>
        {(subtitle || trend) && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            {trend && (
              <span
                className={cn(
                  'font-semibold',
                  trend.isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                )}
              >
                {trend.isPositive ? '↑' : '↓'} {trend.value}
              </span>
            )}
            {subtitle && <span className="text-slate-500 dark:text-slate-400">{subtitle}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
