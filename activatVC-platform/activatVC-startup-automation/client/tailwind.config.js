/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0f172a',
          blue: '#1d4ed8',
          green: '#16a34a',
          amber: '#d97706',
          red: '#dc2626',
          light: '#f8fafc'
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'sans-serif'],
      }
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
