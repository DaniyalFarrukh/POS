import React, { useState } from 'react';
import { GrnReceivingForm } from './GrnReceivingForm';
import { SuppliersManager } from './SuppliersManager';

export const PurchasingDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'grn' | 'suppliers'>('grn');

  return (
    <div>
      {/* Tab Switcher */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '20px',
          gap: '8px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('grn')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            borderBottom: activeTab === 'grn' ? '2px solid #0284c7' : '2px solid transparent',
            color: activeTab === 'grn' ? '#0284c7' : '#64748b',
            fontWeight: activeTab === 'grn' ? 700 : 500,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>📥</span> Goods Receiving Note (GRN)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('suppliers')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            borderBottom: activeTab === 'suppliers' ? '2px solid #0284c7' : '2px solid transparent',
            color: activeTab === 'suppliers' ? '#0284c7' : '#64748b',
            fontWeight: activeTab === 'suppliers' ? 700 : 500,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>🏢</span> Suppliers & Distributors
        </button>
      </div>

      {activeTab === 'grn' ? <GrnReceivingForm /> : <SuppliersManager />}
    </div>
  );
};
