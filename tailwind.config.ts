import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        background: '#07090E',
        surface: {
          DEFAULT: '#0F131D',
          elevated: '#171D2B',
          hover: '#1F273A',
          border: '#273248',
        },
        signal: {
          DEFAULT: '#06B6D4',
          hover: '#22D3EE',
          active: '#0891B2',
        },
        accent: {
          cyan: '#06B6D4',
          orange: '#F97316',
          green: '#10B981',
          rose: '#F43F5E',
          purple: '#A855F7',
          amber: '#F59E0B',
        },
      },
    },
  },
  plugins: [],
};

export default config;
