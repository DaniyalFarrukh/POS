import React from 'react';
import { cn } from '../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', ...props }) => {
  const variantClasses = {
    default: 'bg-[#EEF4FF] text-[#2F64D8] border-[#2F64D8]/30 font-semibold',
    secondary: 'bg-slate-100 text-slate-700 border-slate-200 font-medium',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold',
    warning: 'bg-amber-50 text-amber-800 border-amber-300 font-semibold',
    destructive: 'bg-rose-50 text-rose-700 border-rose-300 font-semibold',
    info: 'bg-blue-50 text-[#2F64D8] border-blue-300 font-semibold',
    outline: 'border border-slate-300 text-slate-700 bg-white font-medium',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
};
