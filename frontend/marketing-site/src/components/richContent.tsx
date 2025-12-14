import clsx from 'clsx';
import type { ReactNode } from 'react';

export const renderRichContent = (value?: string, className?: string): ReactNode => {
  if (!value) return null;
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(value);
  if (looksLikeHtml) {
    return (
      <div className={clsx('rich-prose text-base leading-7 text-slate-600', className)} dangerouslySetInnerHTML={{ __html: value }} />
    );
  }
  const paragraphs = value
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return (
    <div className={clsx('space-y-3 text-base leading-7 text-slate-600', className)}>
      {paragraphs.map((paragraph, idx) => (
        <p key={`${paragraph}-${idx}`}>{paragraph}</p>
      ))}
    </div>
  );
};
