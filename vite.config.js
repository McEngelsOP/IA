import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    entries: ['pagina.html', 'login.html', 'ios-android.html']
  },
  build: {
    rollupOptions: {
      input: {
        pagina: 'pagina.html',
        login: 'login.html',
        mobile: 'ios-android.html',
        promocional: 'Pagina promocional/index.html'
      }
    }
  },
  server: {
    port: 5173,
    open: '/login.html'
  }
})

