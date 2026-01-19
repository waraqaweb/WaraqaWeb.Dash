import { defineConfig, transformWithEsbuild } from 'vite';
import fs from 'fs';
import path from 'path';
import react from '@vitejs/plugin-react';

function jsxInJs() {
  return {
    name: 'waraqa:jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      // Only transform app source. Avoid touching dependencies.
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.includes('/src/')) return null;
      if (!normalizedId.endsWith('.js')) return null;

      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic',
      });
    },
  };
}

// Conservative Vite config:
// - Keeps CRA-like dev port/host
// - Produces CRA-compatible output folder (`build/`) for existing deployment
// - Uses `/dashboard/` base path for production builds to match nginx + `homepage`
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    plugins: [
      jsxInJs(),
      {
        name: 'waraqa:favicon-ico',
        configureServer(server) {
          const faviconPath = path.resolve(process.cwd(), 'public', 'favicon.svg');
          server.middlewares.use((req, res, next) => {
            if (req.url === '/favicon.ico') {
              fs.readFile(faviconPath, (err, data) => {
                if (err) {
                  res.statusCode = 404;
                  res.end();
                  return;
                }
                res.setHeader('Content-Type', 'image/svg+xml');
                res.statusCode = 200;
                res.end(data);
              });
              return;
            }
            next();
          });
        },
      },
      react({
        include: ['**/*.{js,jsx,ts,tsx}'],
      }),
    ],

    // Ensure dependency scanning/import analysis can parse JSX-in-.js as well.
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx',
        },
      },
    },

    // Dev server should work from root (fast local iteration).
    // Production assets must be rooted at /dashboard/.
    base: isBuild ? '/dashboard/' : '/',

    // Keep CRA-compatible env var prefix.
    // Vite will expose these as `import.meta.env.REACT_APP_*`.
    envPrefix: ['VITE_', 'REACT_APP_'],

    publicDir: 'public',

    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
    },

    preview: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
    },

    build: {
      // Preserve deploy assumptions (docker/nginx copies /app/build).
      outDir: 'build',
      assetsDir: 'static',
      sourcemap: false,
      emptyOutDir: true,
    },
  };
});
