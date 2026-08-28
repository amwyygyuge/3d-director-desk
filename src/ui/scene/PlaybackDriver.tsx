import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { useDirectorDeskStores } from "../DirectorDeskContext";

/**
 * 播放驱动(渲染循环挂点):
 * - useFrame 每帧 clock.tick(delta)——暂停时是空操作,零分配;
 * - 订阅 playhead:seek/播放推进后补 invalidate,保证 demand 模式下 scrub 立即成像。
 * 播放期 frameloop 由 DirectorDesk 按 clock.isPlaying 切 "always",暂停回 "demand"。
 */
export function PlaybackDriver() {
    const { clock } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    useEffect(() => clock.subscribe(() => invalidate()), [clock, invalidate]);

    useFrame((_, delta) => {
        clock.tick(delta);
    });

    return null;
}
