/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        ink: { 50: '#f7f7f8', 100: '#e9eaee', 200: '#cdd0d8', 700: '#3a3f4b', 900: '#15181f' },
      },
    },
  },
  plugins: [],
}
