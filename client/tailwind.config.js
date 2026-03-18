/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Pure white light theme
        base: '#ffffff',
        card: '#ffffff',
        'card-border': '#e2e8f0',
        // Primary: blue
        primary: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          light: '#60a5fa',
          50: '#eff6ff',
          100: '#dbeafe',
        },
        // Content text colors
        content: {
          DEFAULT: '#0f172a',
          muted: '#475569',
          subtle: '#94a3b8',
        },
        // Nav bar — deep navy
        nav: '#1E3A5F',
        'nav-border': '#162d4a',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
