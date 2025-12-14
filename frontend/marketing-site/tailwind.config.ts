import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1F5E5A',
          light: '#2C736C',
          dark: '#0F3B38'
        }
      }
    }
  },
  plugins: []
};

export default config;
