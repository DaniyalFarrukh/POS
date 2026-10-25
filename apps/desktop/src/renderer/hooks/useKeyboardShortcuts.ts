import { useEffect, useState } from 'react';

export interface ShortcutHandlers {
  onPay?: () => void;
  onSearchFocus?: () => void;
  onHoldCart?: () => void;
  onCustomerNotes?: () => void;
  onDeleteLine?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const [isAltHeld, setIsAltHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltHeld(true);
      }

      // If Escape is pressed, always trigger escape handler to dismiss modals
      if (event.key === 'Escape') {
        if (handlers.onEscape) {
          event.preventDefault();
          handlers.onEscape();
        }
        return;
      }

      // Check if target is a text input / textarea
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // F-Keys should work even inside inputs
      if (event.key === 'F2') {
        event.preventDefault();
        handlers.onPay?.();
        return;
      }

      if (event.key === 'F3') {
        event.preventDefault();
        handlers.onSearchFocus?.();
        return;
      }

      if (event.key === 'F4') {
        event.preventDefault();
        handlers.onHoldCart?.();
        return;
      }

      if (event.key === 'F6') {
        event.preventDefault();
        handlers.onCustomerNotes?.();
        return;
      }

      // Delete key removes selected line when not actively editing text in an input
      if (event.key === 'Delete' && !isInput) {
        event.preventDefault();
        handlers.onDeleteLine?.();
        return;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltHeld(false);
      }
    };

    const handleWindowBlur = () => {
      setIsAltHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [handlers]);

  return { isAltHeld };
}
