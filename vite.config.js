import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html', 'pagina.html', 'login.html', 'ios-android.html']
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        pagina: 'pagina.html',
        login: 'login.html',
        mobile: 'ios-android.html'
      }
    }
  },
  server: {
    port: 5173,
    open: true
  }
})
