import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Matches what Next.js already infers on its own (the repo root, since
  // clicksplain's package-lock.json is the outer one Turbopack finds walking
  // up), just made explicit to silence the "multiple lockfiles" warning.
  // Pinning this to the example's own directory instead breaks resolution of
  // the symlinked clicksplain package (the file: dependency resolves outside
  // that narrower root), so don't "fix" it that way.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
