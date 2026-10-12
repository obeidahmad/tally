import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
    fs: { allow: ['..'] }, // design/ sits next to web/
  },
  test: { environment: 'node', css: { include: /\.css\?raw$/ } }, // lets colours.test.ts read app.css as text
});
