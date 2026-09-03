import { useCallback, useEffect, useRef } from "react";
import type { Object3D } from "three";

import type { CaptureHelperRegistry } from "@/capture/CaptureHelperRegistry";

interface CaptureHelperRegistrationOptions {
    readonly isPoseHelper?: boolean;
}

/** Registers one mounted helper root with its desk-local capture registry and releases it with the React ref lifecycle. */
export function useCaptureHelperRegistration<T extends Object3D>(
    registry: CaptureHelperRegistry,
    options?: CaptureHelperRegistrationOptions,
): (helper: T | null) => void {
    const unregisterRef = useRef<(() => void) | null>(null);
    const isPoseHelper = options?.isPoseHelper === true;
    const releaseHelper = useCallback(() => {
        unregisterRef.current?.();
        unregisterRef.current = null;
    }, []);
    const registerHelper = useCallback(
        (helper: T | null) => {
            releaseHelper();
            if (!helper) return;
            helper.userData.helper = true;
            if (isPoseHelper) helper.userData.poseHelper = true;
            unregisterRef.current = registry.register(helper);
        },
        [isPoseHelper, registry, releaseHelper],
    );

    useEffect(() => releaseHelper, [releaseHelper]);
    return registerHelper;
}
