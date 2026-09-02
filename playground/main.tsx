import { createRoot } from "react-dom/client";
import { useCallback, useLayoutEffect, useRef } from "react";

import { DirectorDesk } from "@/index";
import type { DirectorDeskStores } from "@/index";
import "@/styles/index.css";
import "./index.css";
import { LocalStorageScenePersistence } from "./LocalStorageScenePersistence";

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

export function Playground() {
    const persistenceRef = useRef<LocalStorageScenePersistence | null>(null);
    const handleReady = useCallback((stores: DirectorDeskStores): void => {
        persistenceRef.current?.dispose();
        const persistence = new LocalStorageScenePersistence(stores, window.localStorage);
        persistence.restore();
        persistence.start();
        persistenceRef.current = persistence;
        window.__directorDesk = stores;
    }, []);

    useLayoutEffect(
        () => () => {
            persistenceRef.current?.dispose();
            delete window.__directorDesk;
        },
        [],
    );

    return (
        <div style={{ width: "100vw", height: "100vh", margin: 0 }}>
            <DirectorDesk onReady={handleReady} />
        </div>
    );
}

createRoot(container).render(<Playground />);
