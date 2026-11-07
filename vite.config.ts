import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  server: { host: "127.0.0.1", port: 3000 },
  // npm run analyze writes .output/stats.html with gzip sizes per chunk.
  plugins: [
    tailwindcss(),
    tanstackStart(),
    react(),
    nitro(),
    process.env.ANALYZE ? visualizer({ filename: ".output/stats.html", gzipSize: true }) : null,
  ],
});
