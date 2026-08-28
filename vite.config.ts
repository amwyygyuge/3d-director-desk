import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const EXTERNALS = [
    /^react($|\/)/,
    /^react-dom($|\/)/,
    /^three($|\/)/,
    /^@react-three\//,
    /^mobx($|-)/,
];

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
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
});
