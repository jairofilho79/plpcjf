/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        'background-color': '#4B2D2B',
        'card-color': '#FFF8E1',
        'card-bg': '#f8f9fa',
        'title-color': '#6A2F2F',
        'gold-color': '#D4AF37',
        'placeholder-color': '#F0E68C',
        'btn-background-color': '#6A3B39',
        'text-light': '#ffffff',
        'text-dark': '#2c3e50',
        'badge-blue-bg': '#5a7a9c',
        'badge-gray-bg': '#9ca3af'
      },
      fontFamily: {
        garamond: ['EB Garamond', 'serif'],
        sans: ['Open Sans', 'sans-serif']
      },
      boxShadow: {
        'md': '0 4px 6px rgba(0,0,0,0.1)',
        'lg': '0 10px 15px rgba(0,0,0,0.2)'
      },
      borderRadius: {
        'DEFAULT': '8px',
        'card': '12px',
        'chip': '24px'
      },
      spacing: {
        '0.5': '0.5rem',
        '1': '1rem',
        '1.5': '1.5rem',
        '2': '2rem'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')
  ]
}

