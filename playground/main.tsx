import { createRoot } from "react-dom/client";

import { DirectorDesk } from "../src";
import type { DirectorDeskStores } from "../src";
import "../src/styles/index.css";

declare global {
    interface Window {
        /**
         * agent/调试驱动句柄(playground 专用,不进发包产物):
         * 写操作走 __directorDesk.dispatcher.dispatch(命令层幻觉围栏生效),
         * 读操作走 dispatcher.query 或直读 observable stores;能力清单见 listCapabilities()。
         */
        __directorDesk?: DirectorDeskStores;
    }
}

const container = document.getElementById("root");
if (!container) throw new Error("playground: #root not found");

createRoot(container).render(
    <div style={{ width: "100vw", height: "100vh", margin: 0 }}>
        <DirectorDesk
            onReady={(stores) => {
                window.__directorDesk = stores;
            }}
        />
    </div>,
);
