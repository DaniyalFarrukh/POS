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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '280px' }}>
      {/* Masked PIN Display */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '10px',
          margin: '16px 0 24px 0',
          minHeight: '28px',
        }}
      >
        {[...Array(Math.max(4, pin.length))].map((_, index) => {
          const filled = index < pin.length;
          return (
            <div
              key={index}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                border: filled ? '2px solid #2563eb' : '2px solid #cbd5e1',
                backgroundColor: filled ? '#2563eb' : '#f8fafc',
                transition: 'all 0.15s ease-in-out',
                transform: filled ? 'scale(1.1)' : 'scale(1)',
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
          gap: '12px',
          width: '100%',
        }}
      >
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={disabled}
            onClick={() => handleDigit(digit)}
            style={{
              height: '56px',
              fontSize: '22px',
              fontWeight: 600,
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#1e293b',
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'background-color 0.1s, transform 0.05s',
              userSelect: 'none',
            }}
            onMouseDown={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseUp={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
          >
            {digit}
          </button>
        ))}

        {/* Bottom row: Clear, 0, Backspace */}
        <button
          type="button"
          disabled={disabled || pin.length === 0}
          onClick={handleClear}
          style={{
            height: '56px',
            fontSize: '13px',
            fontWeight: 600,
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            color: '#64748b',
            cursor: disabled || pin.length === 0 ? 'not-allowed' : 'pointer',
            userSelect: 'none',
          }}
        >
          CLEAR
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleDigit('0')}
          style={{
            height: '56px',
            fontSize: '22px',
            fontWeight: 600,
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            color: '#1e293b',
            cursor: disabled ? 'not-allowed' : 'pointer',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            userSelect: 'none',
          }}
          onMouseDown={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
          onMouseUp={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
        >
          0
        </button>

        <button
          type="button"
          disabled={disabled || pin.length === 0}
          onClick={handleBackspace}
          style={{
            height: '56px',
            fontSize: '16px',
            fontWeight: 600,
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            color: '#64748b',
            cursor: disabled || pin.length === 0 ? 'not-allowed' : 'pointer',
            userSelect: 'none',
          }}
          title="Backspace"
        >
          ⌫
        </button>
      </div>

      {/* Enter / Submit Button */}
      <button
        type="button"
        disabled={disabled || pin.length < 4}
        onClick={onSubmit}
        style={{
          marginTop: '16px',
          width: '100%',
          height: '48px',
          fontSize: '16px',
          fontWeight: 600,
          borderRadius: '8px',
          border: 'none',
          backgroundColor: pin.length >= 4 && !disabled ? '#2563eb' : '#94a3b8',
          color: '#ffffff',
          cursor: pin.length >= 4 && !disabled ? 'pointer' : 'not-allowed',
          boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
          transition: 'background-color 0.15s',
          userSelect: 'none',
        }}
      >
        Submit PIN (Enter)
      </button>
    </div>
  );
};
