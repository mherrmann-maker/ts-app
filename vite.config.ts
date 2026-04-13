import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main:    resolve(__dirname, 'index.html'),
        strudel: resolve(__dirname, 'strudel.html'),
      },
    },
  },
})
