import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// conicPolygonGeometry is the local class that three-globe gets in place of
// three-conic-polygon-geometry. The second name reaches the upstream build,
// which the package exports do not expose as a subpath.
const conicPolygonGeometry = fileURLToPath(
  new URL('./src/lib/globe/conic-polygon-geometry.ts', import.meta.url),
)
const conicPolygonGeometryUpstream = fileURLToPath(
  new URL(
    './node_modules/three-conic-polygon-geometry/dist/three-conic-polygon-geometry.mjs',
    import.meta.url,
  ),
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^three-conic-polygon-geometry$/, replacement: conicPolygonGeometry },
      { find: /^three-conic-polygon-geometry-upstream$/, replacement: conicPolygonGeometryUpstream },
    ],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
