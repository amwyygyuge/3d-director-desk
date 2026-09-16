import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { startDirectorBridge, stopDirectorBridge } from "./scripts/bridge.mjs";

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
/** 桥接服务的默认端口;与 bridge.mjs 的 DEFAULT_PORT 同源。 */
const DIRECTOR_BRIDGE_PORT = 4005;

/**
 * 在本地开发模式下随 Vite 启动多端 RPC 桥接服务。
 * 仅在 serve 且未显式关闭时启用;构建期不加载桥接模块。
 */
function directorBridgeDevPlugin(): Plugin {
    return {
        name: "director-bridge-dev-plugin",
        apply: "serve",
        async configureServer(server) {
            const bridge = startDirectorBridge({ port: DIRECTOR_BRIDGE_PORT });
            try {
                await bridge.listen(DIRECTOR_BRIDGE_PORT);
            } catch (err) {
                // 端口被占(通常是上次 dev 的残留进程):导演台照常起,只是本进程不再提供桥
                server.config.logger.warn(
                    `[director-bridge] 端口 ${DIRECTOR_BRIDGE_PORT} 不可用,跳过桥接启动: ${String(err)}`,
                );
                return;
            }
            server.httpServer?.on("close", () => {
                void stopDirectorBridge(DIRECTOR_BRIDGE_PORT);
            });
        },
    };
}

export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss(), directorBridgeDevPlugin()],
    server: {
        port: 4002,
        strictPort: true,
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    ...(mode === PLAYGROUND_BUILD_MODE
        ? {
              build: {
                  outDir: "dist-playground",
              },
          }
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
