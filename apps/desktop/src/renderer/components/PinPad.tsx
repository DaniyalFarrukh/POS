import React, { useEffect } from 'react';

interface PinPadProps {
  pin: string;
  onChange: (pin: string) => void;
  onSubmit: () => void;
  maxLength?: number;
  disabled?: boolean;
}

export const PinPad: React.FC<PinPadProps> = ({
  pin,
  onChange,
  onSubmit,
  maxLength = 8,
  disabled = false,
}) => {
  const handleDigit = (digit: string) => {
    if (disabled || pin.length >= maxLength) return;
    onChange(pin + digit);
  };

  const handleBackspace = () => {
    if (disabled || pin.length === 0) return;
    onChange(pin.slice(0, -1));
  };

  const handleClear = () => {
    if (disabled) return;
    onChange('');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length >= 4) {
          onSubmit();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, disabled, maxLength, onSubmit]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '290px' }}>
      {/* Masked PIN Display with Glow */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '12px',
          margin: '16px 0 24px 0',
          minHeight: '32px',
          alignItems: 'center',
        }}
      >
        {[...Array(Math.max(4, pin.length))].map((_, index) => {
          const filled = index < pin.length;
          return (
            <div
              key={index}
              style={{
                width: filled ? '16px' : '14px',
                height: filled ? '16px' : '14px',
                borderRadius: '50%',
                border: filled ? '2px solid #2563eb' : '2px solid #cbd5e1',
                background: filled ? '#2563eb' : '#ffffff',
                boxShadow: filled ? '0 0 8px rgba(37, 99, 235, 0.4)' : 'none',
                transition: 'all 0.15s var(--ease-spring)',
                transform: filled ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          );
        })}
      </div>

      {/* Numeric Keypad Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '10px',
          width: '100%',
        }}
      >
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            className="pinpad-btn"
            disabled={disabled}
            onClick={() => handleDigit(digit)}
          >
            {digit}
          </button>
        ))}

        {/* Bottom row: Clear, 0, Backspace */}
        <button
          type="button"
          className="pinpad-btn"
          disabled={disabled || pin.length === 0}
          onClick={handleClear}
          style={{
            fontSize: '11.5px',
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: pin.length > 0 ? '#e11d48' : '#94a3b8',
            backgroundColor: pin.length > 0 ? '#fff1f2' : '#f8fafc',
            borderColor: pin.length > 0 ? '#fecdd3' : '#e2e8f0',
          }}
        >
          CLEAR
        </button>

        <button
          type="button"
          className="pinpad-btn"
          disabled={disabled}
          onClick={() => handleDigit('0')}
        >
          0
        </button>

        <button
          type="button"
          className="pinpad-btn"
          disabled={disabled || pin.length === 0}
          onClick={handleBackspace}
          style={{
            fontSize: '18px',
            color: pin.length > 0 ? '#475569' : '#94a3b8',
          }}
          title="Backspace"
        >
          ⌫
        </button>
      </div>

      {/* Enter / Submit Button with Accessible Contrast */}
      <button
        type="button"
        className="interactive-btn"
        disabled={disabled || pin.length < 4}
        onClick={onSubmit}
        style={{
          marginTop: '16px',
          width: '100%',
          height: '48px',
          fontSize: '14px',
          fontWeight: 700,
          borderRadius: '10px',
          border: pin.length >= 4 && !disabled ? '1px solid #1d4ed8' : '1px solid #e2e8f0',
          backgroundColor: pin.length >= 4 && !disabled ? '#2563eb' : '#f1f5f9',
          color: pin.length >= 4 && !disabled ? '#ffffff' : '#64748b',
          cursor: pin.length >= 4 && !disabled ? 'pointer' : 'not-allowed',
          boxShadow: pin.length >= 4 && !disabled ? '0 4px 12px rgba(37, 99, 235, 0.28)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          transition: 'all 0.15s ease',
        }}
      >
        <span>Submit PIN</span>
        <kbd
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '5px',
            backgroundColor: pin.length >= 4 && !disabled ? 'rgba(255, 255, 255, 0.2)' : '#ffffff',
            border: pin.length >= 4 && !disabled ? '1px solid rgba(255, 255, 255, 0.35)' : '1px solid #cbd5e1',
            color: pin.length >= 4 && !disabled ? '#ffffff' : '#64748b',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Enter ↵
        </kbd>
      </button>
    </div>
  );
};
