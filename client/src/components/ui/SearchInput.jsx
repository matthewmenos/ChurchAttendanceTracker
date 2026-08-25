import { useEffect, useRef, useState } from 'react';
import { IconX } from './icons.jsx';

/** Debounced search box; parent receives trimmed values via onDebounce. */
export default function SearchInput({ placeholder = 'Search…', initialValue = '', onDebounce, ariaLabel = 'Search', autoFocus }) {
  const [text, setText] = useState(initialValue);
  const timer = useRef(null);
  const cbRef = useRef(onDebounce);
  cbRef.current = onDebounce;

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleChange = (e) => {
    const value = e.target.value;
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => cbRef.current(value.trim()), 300);
  };

  const clear = () => {
    setText('');
    clearTimeout(timer.current);
    cbRef.current('');
  };

  return (
    <div className="search-input">
      <svg className="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
        <path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        className="input search-field"
        type="search"
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus || undefined}
      />
      {text && (
        <button type="button" className="search-clear" onClick={clear} aria-label="Clear search">
          <IconX size={12} />
        </button>
      )}
    </div>
  );
}