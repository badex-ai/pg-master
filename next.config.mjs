/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite ships WASM and must be transpiled by Next's build system.
  // See https://pglite.dev/docs/bundler-support
  transpilePackages: ['@electric-sql/pglite', '@electric-sql/pglite-react'],
};

export default nextConfig;
