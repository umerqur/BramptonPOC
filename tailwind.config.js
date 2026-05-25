/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f3f5f9',
          100: '#e3e8f1',
          200: '#c2cce0',
          300: '#94a4c5',
          400: '#6477a5',
          500: '#445a89',
          600: '#33476f',
          700: '#28395a',
          800: '#1b2944',
          900: '#0f1a30',
          950: '#08111f',
        },
        accent: {
          50: '#f0f9f6',
          100: '#daefe6',
          200: '#b7dfcf',
          300: '#85c7b1',
          400: '#52ab8e',
          500: '#358f73',
          600: '#26735c',
          700: '#205c4b',
          800: '#1c4a3d',
          900: '#193d33',
        },
        ink: {
          DEFAULT: '#0f1a30',
          muted: '#4a5673',
          subtle: '#6b7693',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 26 48 / 0.04), 0 1px 3px 0 rgb(15 26 48 / 0.06)',
        cardHover: '0 4px 12px -2px rgb(15 26 48 / 0.08), 0 2px 6px -2px rgb(15 26 48 / 0.06)',
      },
    },
  },
  plugins: [],
}
