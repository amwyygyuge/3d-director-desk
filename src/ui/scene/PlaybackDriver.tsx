import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { useDirectorDeskStores } from "../DirectorDeskContext";

const MILLISECONDS_PER_SECOND = 1000;

/**
 * - useFrame 每帧推进当前模型的局部动作预览，再推进全局 Timeline 时钟；暂停态均为零分配空操作；
 * - PlaybackCoordinator 仍是全局 playhead 的唯一订阅者：按 tick 最多 invalidates 一次，seek 也立即成像；
 * - 动作预览期和 Timeline 播放期均由 DirectorDesk 切为 frameloop="always"。
 */
export function PlaybackDriver() {
    const { actionPreview, clock, frameRate, playback } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    useEffect(() => {
        playback.bindInvalidator(invalidate);
        return () => playback.unbindInvalidator(invalidate);
    }, [playback, invalidate]);

    useFrame((state, delta) => {
        frameRate.recordFrame(state.clock.elapsedTime * MILLISECONDS_PER_SECOND);
        actionPreview.tick(delta);
        clock.tick(delta);
    });

    return null;
}
