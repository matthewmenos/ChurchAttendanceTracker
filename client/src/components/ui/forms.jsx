import { cloneElement, isValidElement, useState } from 'react';
import { IconEye, IconEyeOff } from './icons.jsx';

/** Accessible form field wrapper: wires label, hint and error to the control. */
export function Field({ label, id, error, hint, required, children, className = '' }) {
  const child = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
      })
    : children;
  return (
    <div className={`field ${className}`.trim()}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="req" aria-hidden="true"> *</span>}
        </label>
      )}
      {child}
      {hint && !error && (
        <div className="field-hint" id={`${id}-hint`}>{hint}</div>
      )}
      {error && (
        <div className="field-error" id={`${id}-error`} role="alert">{error}</div>
      )}
    </div>
  );
}

export function Button({ variant = 'primary', size = '', loading = false, type = 'button', className = '', children, disabled, ...rest }) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${className ? ` ${className}` : ''}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function Input({ className = '', ...rest }) {
  return <input className={`input ${className}`.trim()} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select className={`input ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ rows = 3, className = '', ...rest }) {
  return <textarea rows={rows} className={`input ${className}`.trim()} {...rest} />;
}

export function Checkbox({ label, id, className = '', ...rest }) {
  return (
    <label className={`checkbox ${className}`.trim()} htmlFor={id}>
      <input id={id} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Password field with a show/hide toggle. Toggling only swaps the input's
 * `type` attribute on the same DOM node, so focus and the caret stay put.
 */
export function PasswordInput({ id, className = '', ...rest }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="password-wrap">
      <input id={id} className="input" type={reveal ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setReveal((v) => !v)}
        aria-label={reveal ? 'Hide password' : 'Show password'}
        aria-pressed={reveal}
      >
        {reveal ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}