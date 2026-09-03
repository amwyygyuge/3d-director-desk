import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const EXTERNALS = [
    /^react($|\/)/,
    /^react-dom($|\/)/,
    /^three($|\/)/,
    /^@react-three\//,
    /^@mui\//,
    /^@emotion\//,
    /^mobx($|-)/,
];

const PLAYGROUND_BUILD_MODE = "playground";

export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss()],
    server: {
        port: 4000,
        strictPort: true,
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    ...(mode === PLAYGROUND_BUILD_MODE
        ? {}
        : {
              build: {
                  lib: {
                      entry: "src/index.ts",
                      formats: ["es"],
                      fileName: () => "index.js",
                      cssFileName: "style",
                  },
                  rollupOptions: {
                      external: EXTERNALS,
                  },
                  sourcemap: true,
                  minify: false,
              },
          }),
}));
