'use client';

import { useEffect } from 'react';

const applyDirAuto = (root: ParentNode | Document) => {
  // Add dir="auto" to common typing surfaces so RTL scripts (Arabic) behave correctly.
  const selector = 'input:not([dir]), textarea:not([dir]), select:not([dir]), [contenteditable="true"]:not([dir])';
  const nodes = (root as ParentNode).querySelectorAll?.(selector);
  if (!nodes) return;

  nodes.forEach((node) => {
    try {
      (node as HTMLElement).setAttribute('dir', 'auto');
    } catch {
      // ignore
    }
  });
};

export default function DirAuto() {
  useEffect(() => {
    try {
      applyDirAuto(document);
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node && node.nodeType === 1) {
              applyDirAuto(node as ParentNode);
            }
          });
        }
      });

      observer.observe(document.documentElement, { childList: true, subtree: true });
      return () => observer.disconnect();
    } catch {
      return;
    }
  }, []);

  return null;
}
