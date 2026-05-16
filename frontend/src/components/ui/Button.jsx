import React from 'react';

/**
 * Canonical Button primitive for the app.
 *
 * Variants:
 *   primary  — solid brand button (default)
 *   secondary— soft slate background
 *   ghost    — transparent, hover tinted
 *   danger   — destructive action
 *   link     — text-style button
 *
 * Sizes:
 *   sm | md (default) | lg
 *
 * Extras:
 *   circle   — render as round icon button (uses size for diameter)
 *   loading  — disables and renders a spinner
 *   iconLeft / iconRight — optional adornments (lucide / svg)
 */

const VARIANT_CLASSES = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary disabled:bg-primary/60',
  secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-slate-300 disabled:opacity-60',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-200 disabled:opacity-60',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive disabled:bg-destructive/60',
  link: 'bg-transparent text-primary hover:underline focus-visible:ring-primary px-1 py-0 shadow-none',
};

const SIZE_CLASSES_DEFAULT = {
  sm: 'text-xs px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2 gap-2',
  lg: 'text-base px-5 py-2.5 gap-2',
};

const SIZE_CLASSES_CIRCLE = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-14 w-14',
};

const BASE_DEFAULT =
  'inline-flex items-center justify-center rounded-lg font-medium shadow-sm ' +
  'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed';

const BASE_CIRCLE =
  'inline-flex items-center justify-center rounded-full shadow-lg ' +
  'transition transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:hover:scale-100';

const Spinner = ({ className = '' }) => (
  <svg
    className={`animate-spin h-4 w-4 ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
  </svg>
);

const Button = React.forwardRef(function Button(
  {
    children,
    className = '',
    variant = 'primary',
    size = 'md',
    circle = false,
    loading = false,
    disabled = false,
    iconLeft = null,
    iconRight = null,
    type = 'button',
    ...rest
  },
  ref,
) {
  const base = circle ? BASE_CIRCLE : BASE_DEFAULT;
  const sizeCls = (circle ? SIZE_CLASSES_CIRCLE : SIZE_CLASSES_DEFAULT)[size] || '';
  const variantCls = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={`${base} ${variantCls} ${sizeCls} ${className}`.trim()}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {!circle && children}
      {circle && !loading && children}
      {!loading && iconRight}
    </button>
  );
});

export default Button;
