import React, { useState, useEffect, useRef } from 'react';
import type { CustomerInfo } from './types';

interface CustomerNotesModalProps {
  initialData: CustomerInfo;
  onSave: (data: CustomerInfo) => void;
  onClose: () => void;
}

export const CustomerNotesModal: React.FC<CustomerNotesModalProps> = ({
  initialData,
  onSave,
  onClose,
}) => {
  const [formData, setFormData] = useState<CustomerInfo>(initialData);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-notes-modal-title"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content-card"
        style={{
          width: '540px',
          maxWidth: '100%',
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>👤</span>
            <h3
              id="customer-notes-modal-title"
              style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}
            >
              Customer & Prescription Notes
            </h3>
            <kbd className="kbd-cap" style={{ fontSize: '10px', padding: '1px 5px' }}>F6</kbd>
          </div>
          <button
            type="button"
            className="interactive-btn"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              width: '30px',
              height: '30px',
              fontSize: '16px',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '22px 24px' }}>
          <div style={{ marginBottom: '14px' }}>
            <label
              htmlFor="cust-name"
              style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
            >
              Patient / Customer Name
            </label>
            <input
              id="cust-name"
              ref={firstInputRef}
              type="text"
              placeholder="e.g. Muhammad Ali or Walk-in Customer"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label
              htmlFor="cust-phone"
              style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
            >
              Contact Number
            </label>
            <input
              id="cust-phone"
              type="text"
              placeholder="e.g. 0300-1234567"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="tabular-nums"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label
              htmlFor="cust-doctor"
              style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
            >
              Prescribing Doctor / Clinic
            </label>
            <input
              id="cust-doctor"
              type="text"
              placeholder="e.g. Dr. Tariq Mahmood (Civil Hospital)"
              value={formData.doctorName}
              onChange={(e) => setFormData({ ...formData, doctorName: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="cust-notes"
              style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
            >
              Prescription / Dosage Instructions / Notes
            </label>
            <textarea
              id="cust-notes"
              rows={3}
              placeholder="e.g. Take 1 tablet twice daily after meals. Refill after 10 days."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
                resize: 'vertical',
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              paddingTop: '14px',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <button
              type="button"
              className="interactive-btn"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              className="interactive-btn"
              style={{
                padding: '10px 22px',
                background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 800,
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
              }}
            >
              Attach to Sale
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
