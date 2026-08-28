import { observer } from "mobx-react";

import { useDirectorDeskStores } from "./DirectorDeskContext";

/**
 * 机位视角的取景框叠加:画幅框 + 三分构图网格 + 机位名。
 * 纯展示层(DOM overlay,pointer-events 全透传),不碰 three;
 * 截图隐藏辅助物时按 data-helper 属性被摘(07 任务消费)。
 */
export const ShotFrameOverlay = observer(function ShotFrameOverlay() {
    const { camera } = useDirectorDeskStores();
    if (!camera.activeShotId) return null;

    return (
        <div data-helper="shot-frame" className="pointer-events-none absolute inset-0 z-[1]">
            <div className="absolute inset-3 border border-amber-200/70" />
            <div
                className="absolute top-3 bottom-3 border-l border-white/25"
                style={{ left: `calc(0.75rem + (100% - 1.5rem) / 3)` }}
            />
            <div
                className="absolute top-3 bottom-3 border-l border-white/25"
                style={{ left: `calc(0.75rem + (100% - 1.5rem) * 2 / 3)` }}
            />
            <div
                className="absolute left-3 right-3 border-t border-white/25"
                style={{ top: `calc(0.75rem + (100% - 1.5rem) / 3)` }}
            />
            <div
                className="absolute left-3 right-3 border-t border-white/25"
                style={{ top: `calc(0.75rem + (100% - 1.5rem) * 2 / 3)` }}
            />
            <span className="absolute left-5 top-5 text-xs text-amber-200/90">机位视角 · {camera.activeShotId}</span>
        </div>
    );
});
