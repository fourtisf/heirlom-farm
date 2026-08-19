/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The genetics package ships TypeScript-built ESM from the workspace.
  transpilePackages: ['@heirloom/genetics'],
};

export default nextConfig;
