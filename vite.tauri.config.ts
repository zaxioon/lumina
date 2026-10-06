import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { outDir: resolve(__dirname, 'dist/tauri'), emptyOutDir: true, target: 'es2021' },
})
