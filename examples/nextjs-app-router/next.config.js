/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the local workspace package
  transpilePackages: ["@opencoredev/billing-sdk"],
};

module.exports = nextConfig;
