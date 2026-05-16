import React from 'react';
import Button from './Button';

/**
 * Back-compat wrapper around the canonical {@link Button} primitive.
 * Existing call sites use `<PrimaryButton variant="primary|subtle|danger" />`;
 * legacy `subtle` maps to the new `secondary` variant.
 *
 * Prefer importing `Button` directly in new code.
 */
export default function PrimaryButton({ variant = 'primary', ...props }) {
  const mapped = variant === 'subtle' ? 'secondary' : variant;
  return <Button variant={mapped} {...props} />;
}
