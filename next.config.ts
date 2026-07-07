import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = path.dirname(new URL(import.meta.url).pathname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  typedRoutes: true
};

export default nextConfig;
