import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
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
