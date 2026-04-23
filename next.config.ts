import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["inco-x402-sessions"],
  outputFileTracingRoot: path.resolve(__dirname, ".."),
};

export default nextConfig;
