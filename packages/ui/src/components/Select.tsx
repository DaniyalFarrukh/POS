import React from 'react';
import { cn } from '../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={cn(
            'flex h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pe-8 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2F64D8]/20 focus:border-[#2F64D8] disabled:cursor-not-allowed disabled:opacity-50 transition-all shadow-2xs',
            error
              ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20'
              : 'border-slate-300',
            className
          )}
          {...props}
        >
          {children}
        </select>
        <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center px-2.5 text-slate-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    );
  }
);
Select.displayName = 'Select';
