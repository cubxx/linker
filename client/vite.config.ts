import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '',
  plugins: [tailwind()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
