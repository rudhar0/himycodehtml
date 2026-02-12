import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  base: './', // Relative base for file:// compatibility in Neutralino
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@store': path.resolve(__dirname, './src/store'),
      '@api': path.resolve(__dirname, './src/api'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@constants': path.resolve(__dirname, './src/constants'),
      '@config': path.resolve(__dirname, './src/config'),
    },
  },
  build: {
    rollupOptions: {
      external: ['./dockerfile/dockerfile.contribution.js'],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('monaco-editor')) return 'vendor-monaco';
            if (id.includes('react')) return 'vendor-react';
            if (id.includes('tree-sitter')) return 'vendor-treesitter';
            return 'vendor';
          }
        },
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 5000,
    target: 'es2022', // Enable top-level await
    assetsDir: 'assets', // Ensure assets go to ./assets/
  },
  esbuild: {
    supported: {
      'top-level-await': true
    },
  },
  optimizeDeps: {
    exclude: ['@monaco-editor/loader'],
    esbuildOptions: {
      supported: {
        'import-meta': true,
        'top-level-await': true
      },
      plugins: [
        {
          name: 'resolve-monaco-contributions',
          setup(build) {
            build.onResolve({ filter: /dockerfile\/dockerfile\.contribution\.js/ }, () => ({
              path: '',
              namespace: 'empty'
            }));
            build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({
              contents: ''
            }));
          }
        }
      ]
    }
  },
  server: {
    port: 5173,
    host: true,
    middlewareMode: false
  }
});