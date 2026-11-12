import React from 'react';
import { cn } from '../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', ...props }) => {
  const variantClasses = {
    default: 'bg-[#EEF4FF] text-[#2F64D8] border-[#2F64D8]/20',
    secondary: 'bg-slate-100 text-slate-700 border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    destructive: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-blue-50 text-[#2F64D8] border-blue-200',
    outline: 'border border-slate-300 text-slate-700 bg-white',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
};
