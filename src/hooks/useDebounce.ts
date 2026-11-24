import { useEffect, useState } from 'react';

/**
 * Lightweight debounce hook (default 180ms) to keep search inputs responsive
 * without triggering heavy table re-renders on every keystroke on older Android devices (API 23+).
 */
export function useDebounce<T>(value: T, delayMs = 180): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
