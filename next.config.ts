import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The offline service worker must never be cached by the browser, or a new
  // deploy's version wouldn't be picked up (see public/sw.js).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
