/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      'pdf-parse',
      'adm-zip',
      'exceljs',
      'bcryptjs',
      'jsonwebtoken',
      'pdfkit',
      'fontkit',
      // Phase 2/3: tesseract.js (WASM), pdfjs-dist (legacy build), and
      // @napi-rs/canvas (prebuilt native .node binary) cannot be webpack-
      // bundled — must load at runtime from node_modules on the server.
      '@napi-rs/canvas',
      'tesseract.js',
      'pdfjs-dist',
      // DWG→DXF (LibreDWG) and .7z extraction are WASM modules that load their
      // .wasm at runtime from node_modules — they cannot be webpack-bundled.
      '@mlightcad/libredwg-web',
      '7z-wasm',
    ],
    // Without this, Vercel's serverless build skips tests/fixtures/* because
    // the paths are computed at runtime (process.cwd() + 'tests/fixtures').
    // The fixture-replay module reads them, so they must be in the deploy.
    outputFileTracingIncludes: {
      // estimate converts DWG via LibreDWG-WASM → needs its .wasm in the bundle.
      '/api/projects/[id]/estimate': [
        './tests/fixtures/**/*',
        './node_modules/@mlightcad/libredwg-web/wasm/**/*',
      ],
      '/api/projects/[id]/gate': ['./tests/fixtures/**/*'],
      '/api/projects/[id]/power-boq': ['./tests/fixtures/**/*'],
      // extract unpacks .7z via 7z-wasm → needs 7zz.wasm in the bundle.
      '/api/projects/[id]/extract': ['./node_modules/7z-wasm/7zz.wasm'],
    },
  },
}

module.exports = nextConfig
