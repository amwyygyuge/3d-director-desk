import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { useDirectorDeskStores } from "../DirectorDeskContext";

/**
 * - useFrame 每帧 clock.tick(delta)——暂停时是空操作,零分配；
 * - PlaybackCoordinator 是唯一 playhead 订阅者：按 tick 最多 invalidates 一次，seek 也立即成像。
 * 播放期 frameloop 由 DirectorDesk 按 clock.isPlaying 切 "always",暂停回 "demand"。
 */
export function PlaybackDriver() {
    const { clock, playback } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    useEffect(() => {
        playback.bindInvalidator(invalidate);
        return () => playback.unbindInvalidator(invalidate);
    }, [playback, invalidate]);

    useFrame((_, delta) => {
        clock.tick(delta);
    });

    return null;
}
