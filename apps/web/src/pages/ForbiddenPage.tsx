import React from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import type { AppPermission } from '@pos/shared';

interface ForbiddenPageProps {
  requiredPermission?: AppPermission;
  onGoBack?: () => void;
}

export const ForbiddenPage: React.FC<ForbiddenPageProps> = ({ requiredPermission, onGoBack }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-in fade-in duration-200">
      <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mb-4 text-rose-600 shadow-inner">
        <ShieldAlert className="w-8 h-8" />
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">403 - Access Denied</h1>

      <p className="text-sm text-slate-600 max-w-md mb-6 leading-relaxed">
        You do not have permission to access this module or view.
        {requiredPermission && (
          <span className="block mt-2 font-mono text-xs text-rose-700 bg-rose-50 py-1 px-2.5 rounded border border-rose-200 inline-block">
            Required: {requiredPermission}
          </span>
        )}
      </p>

      {onGoBack && (
        <button
          type="button"
          onClick={onGoBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Overview
        </button>
      )}
    </div>
  );
};
