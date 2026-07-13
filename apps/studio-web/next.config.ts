import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@intentform/compiler-core",
    "@intentform/compiler-react",
    "@intentform/compiler-swiftui",
    "@intentform/intent-interpreter",
    "@intentform/proof-report",
    "@intentform/repair-planner",
    "@intentform/semantic-schema",
    "@intentform/verifier",
  ],
  turbopack: {
    root: resolve(import.meta.dirname, "../.."),
  },
};

export default nextConfig;
