import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import fs from 'node:fs';

export default defineConfig({
  base: './', // Relative base for file:// compatibility in Neutralino
  plugins: [
    react(),
    {
      name: 'serve-auth-info',
      configureServer(server) {
        server.middlewares.use('/auth_info.json', (req, res, next) => {
          const authInfoPath = path.resolve(__dirname, '../desktop/.tmp/auth_info.json');
          try {
            if (fs.existsSync(authInfoPath)) {
              const content = fs.readFileSync(authInfoPath, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(content);
              return;
            }
          } catch (e) {
            console.error('Failed to serve auth_info.json', e);
          }
          next();
        });
      }
    }
  ],
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
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
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