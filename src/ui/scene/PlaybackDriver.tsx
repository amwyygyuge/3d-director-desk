import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { useDirectorDeskStores } from "../DirectorDeskContext";

const MILLISECONDS_PER_SECOND = 1000;

/** Camera-only clock driver. Static poses apply on command or camera sample; no model action loop exists. */
export function PlaybackDriver() {
    const { clock, frameRate, playback } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    useEffect(() => {
        playback.bindInvalidator(invalidate);
        return () => playback.unbindInvalidator(invalidate);
    }, [playback, invalidate]);

    useFrame((state, delta) => {
        frameRate.recordFrame(state.clock.elapsedTime * MILLISECONDS_PER_SECOND);
        clock.tick(delta);
    });

    return null;
}
