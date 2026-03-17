/**
 * Copy Button Component
 * 
 * A reusable button component that copies text to clipboard
 * Shows visual feedback when copy is successful
 */

import React, { useState } from 'react';
import { Clipboard, Check, Link2, MessageCircleMore } from 'lucide-react';

const CopyButton = ({ 
  text, 
  className = "", 
  title = "Copy to clipboard",
  size = "default",
  variant = "default",
  icon = "copy"
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
      
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
        
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      } catch (fallbackError) {
        console.error('Fallback copy failed:', fallbackError);
        alert('Failed to copy to clipboard. Please copy manually.');
      }
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'p-1.5';
      case 'lg':
        return 'p-3';
      default:
        return 'p-2';
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'sm':
        return 'h-3 w-3';
      case 'lg':
        return 'h-5 w-5';
      default:
        return 'h-4 w-4';
    }
  };

  const getVariantClasses = () => {
    if (copied) {
      return 'border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100';
    }
    
    switch (variant) {
      case 'ghost':
        return 'text-slate-500 hover:text-slate-700 hover:bg-slate-100';
      case 'outline':
        return 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100';
      case 'blue':
        return 'text-sky-600 hover:bg-sky-50';
      case 'link':
        return 'border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100';
      case 'message':
        return 'border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100';
      default:
        return 'text-slate-500 hover:text-slate-700 hover:bg-slate-100';
    }
  };

  const Icon = icon === 'link' ? Link2 : icon === 'message' ? MessageCircleMore : Clipboard;

  return (
    <button
      onClick={handleCopy}
      className={`
        ${getSizeClasses()}
        ${getVariantClasses()}
        rounded-md transition-all duration-200 
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300
        ${className}
      `}
      title={copied ? 'Copied!' : title}
      disabled={!text}
    >
      {copied ? (
        <Check className={`${getIconSize()} transition-all duration-200`} />
      ) : (
        <Icon className={`${getIconSize()} transition-all duration-200`} />
      )}
    </button>
  );
};

export default CopyButton;

