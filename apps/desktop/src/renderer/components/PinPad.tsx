import React, { useState, useEffect, useRef } from 'react';
import { LockIcon, EyeIcon, EyeOffIcon } from './common/Icons';

interface PinPadProps {
  pin: string;
  onChange: (pin: string) => void;
  onSubmit: () => void;
  maxLength?: number;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export const PinPad: React.FC<PinPadProps> = ({
  pin,
  onChange,
  onSubmit,
  maxLength = 8,
  disabled = false,
  placeholder,
  autoFocus = true,
}) => {
  const [showPin, setShowPin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRef.current?.focus();
    }
  }, [autoFocus, disabled]);

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
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, maxLength);
    onChange(digitsOnly);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      // If the input element itself is focused, let input's native event & onChange handle typing
      if (document.activeElement === inputRef.current) return;

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: '290px',
      }}
    >
      {/* Password / PIN Input Field with Lock Icon and Show/Hide Toggle */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          margin: '10px 0 18px 0',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            pointerEvents: 'none',
          }}
        >
          <LockIcon size={16} />
        </div>

        <input
          ref={inputRef}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={maxLength}
          value={pin}
          disabled={disabled}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (pin.length >= 4) {
                onSubmit();
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handleClear();
            }
          }}
          placeholder={placeholder || 'Enter PIN (4-8 digits)'}
          style={{
            width: '100%',
            height: '46px',
            paddingLeft: '38px',
            paddingRight: '42px',
            fontSize: pin.length > 0 ? (showPin ? '17px' : '22px') : '13.5px',
            fontWeight: pin.length > 0 ? 800 : 500,
            letterSpacing: pin.length > 0 ? (showPin ? '0.12em' : '0.22em') : 'normal',
            textAlign: pin.length > 0 && !showPin ? 'center' : 'left',
            color: '#0f172a',
            backgroundColor: '#ffffff',
            border: '2px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
            boxSizing: 'border-box',
            outline: 'none',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            fontFamily: showPin ? 'var(--font-mono, monospace)' : 'inherit',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#2563eb';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.15)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#e2e8f0';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.05)';
          }}
        />

        {/* Toggle Show/Hide Button */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            setShowPin((prev) => !prev);
            inputRef.current?.focus();
          }}
          title={showPin ? 'Hide PIN' : 'Show PIN'}
          aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
          style={{
            position: 'absolute',
            right: '8px',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: '6px',
            color: '#64748b',
            cursor: disabled ? 'not-allowed' : 'pointer',
            padding: 0,
            transition: 'color 0.15s ease, background-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.color = '#1e293b';
              e.currentTarget.style.backgroundColor = '#f1f5f9';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#64748b';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {showPin ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
        </button>
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
            onClick={() => {
              handleDigit(digit);
              inputRef.current?.focus();
            }}
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
          onClick={() => {
            handleDigit('0');
            inputRef.current?.focus();
          }}
        >
          0
        </button>

        <button
          type="button"
          className="pinpad-btn"
          disabled={disabled || pin.length === 0}
          onClick={() => {
            handleBackspace();
            inputRef.current?.focus();
          }}
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
            border:
              pin.length >= 4 && !disabled
                ? '1px solid rgba(255, 255, 255, 0.35)'
                : '1px solid #cbd5e1',
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
