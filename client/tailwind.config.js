/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1e293b',
          card: '#243447',
          hover: '#2d3f55',
          border: '#334155',
        },
        sidebar: '#0f172a',
        primary: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
        },
      },
    },
  },
  plugins: [],
};
