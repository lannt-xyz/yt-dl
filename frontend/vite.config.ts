/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": báo người dùng khi có bản mới thay vì tự tải lại giữa chừng lúc đang trim/tải
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "YT → MP3",
        short_name: "YT → MP3",
        description: "Tải audio từ YouTube, cắt và lưu thành MP3.",
        lang: "vi",
        start_url: "/",
        scope: "/",
        id: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0d0f14",
        theme_color: "#6d5efc",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          { name: "Tải URL mới", url: "/?tab=download", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
          { name: "Lịch sử", url: "/?tab=history", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        ],
        // Android/Chrome: chia sẻ link từ app YouTube thẳng vào app này (iOS không hỗ trợ Share Target)
        share_target: {
          action: "/",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      } as never,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        // API và SSE phải luôn đi thẳng ra server, không bao giờ trả từ cache
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        importScripts: ["push-sw.js"],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
