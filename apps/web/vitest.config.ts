import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Component tests need a DOM; pure helper tests run fine in it too.
    environment: 'jsdom',
    globals: false,
  },
});
