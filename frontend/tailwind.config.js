/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2C736C',
          soft: 'rgba(44, 115, 108, 0.3)',
          softer: 'rgba(44, 115, 108, 0.5)'
        },

        // Backwards-compat color tokens used across older pages/components.
        // Map to theme variables so production builds don't lose button backgrounds.
        'custom-teal': 'var(--primary)',
        'custom-teal-dark': 'color-mix(in srgb, var(--primary) 85%, black)',

        // App theme tokens
        // Tokens that support alpha modifiers (e.g. bg-primary/10) wrap the CSS
        // variable in color-mix() so opacity works regardless of how the variable
        // is expressed (hex in light mode, oklch in dark mode).
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: 'color-mix(in srgb, var(--primary), transparent calc((1 - <alpha-value>) * 100%))',
        'primary-foreground': 'var(--primary-foreground)',
        destructive: 'color-mix(in srgb, var(--destructive), transparent calc((1 - <alpha-value>) * 100%))',
        'destructive-foreground': 'var(--destructive-foreground)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'color-mix(in srgb, var(--ring), transparent calc((1 - <alpha-value>) * 100%))',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',

        // Sidebar theme tokens (used by Sidebar.jsx via classes like bg-sidebar)
        sidebar: 'var(--sidebar)',
        'sidebar-foreground': 'var(--sidebar-foreground)',
        'sidebar-primary': 'var(--sidebar-primary)',
        'sidebar-primary-foreground': 'var(--sidebar-primary-foreground)',
        'sidebar-accent': 'var(--sidebar-accent)',
        'sidebar-accent-foreground': 'var(--sidebar-accent-foreground)',
        'sidebar-border': 'var(--sidebar-border)',
        'sidebar-ring': 'var(--sidebar-ring)'
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif'
        ],
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translate(-50%, 100%)', opacity: '0' },
          '100%': { transform: 'translate(-50%, 0)', opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
      },
    },
  },
  plugins: [],
}
