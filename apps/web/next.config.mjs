/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The genetics package ships TypeScript-built ESM from the workspace.
  transpilePackages: ['@heirlom/genetics'],

  /* `next dev` and `next build` share `.next` by default, so running a build
     while a dev server is up leaves it serving production chunks — the debug
     bridge vanishes, and eventually it fails outright with a confusing
     "Cannot find module './522.js'". Giving them separate directories makes
     that impossible rather than merely documented. */
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
};

export default nextConfig;
