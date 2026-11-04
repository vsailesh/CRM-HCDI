import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  output: "standalone", // minimal self-contained server for the container image
  serverExternalPackages: ["better-sqlite3-multiple-ciphers"], // native module — must not be bundled
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
