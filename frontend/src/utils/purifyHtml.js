import DOMPurify from 'dompurify';
export const purifyHtml = (value) => ({ __html: DOMPurify.sanitize(value || '') });
