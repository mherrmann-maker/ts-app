import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        beatcut: fileURLToPath(new URL('./beatcut.html', import.meta.url)),
      },
    },
  },
})
