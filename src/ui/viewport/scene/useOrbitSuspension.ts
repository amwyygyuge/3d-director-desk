import { useCallback, useEffect, useRef } from "react";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

export interface OrbitSuspension {
    /** 手势开始:申请轨道让位(重复申请幂等) */
    readonly suspend: () => void;
    /** 手势结束:归还轨道(未申请时无副作用) */
    readonly release: () => void;
}

/**
 * 轨道让位的成对守卫(关键帧小球拖拽与 gizmo 拖拽共用,Rule of Two)。
 *
 * 计数在 ViewportCameraAuthority,这里只保证「谁申请谁归还」:手势中途组件卸载
 * (选中被清、片段被删)也会在卸载时归还,不把轨道永久锁死。
 */
export function useOrbitSuspension(): OrbitSuspension {
    const { viewportCamera, viewportOrbit } = useDirectorDeskStores();
    const suspended = useRef(false);

    const suspend = useCallback(() => {
        if (suspended.current) return;
        suspended.current = true;
        viewportCamera.suspendOrbit();
        viewportOrbit.setEnabled(viewportCamera.isOrbitEnabled);
    }, [viewportCamera, viewportOrbit]);

    const release = useCallback(() => {
        if (!suspended.current) return;
        suspended.current = false;
        viewportCamera.resumeOrbit();
        viewportOrbit.setEnabled(viewportCamera.isOrbitEnabled);
    }, [viewportCamera, viewportOrbit]);

    useEffect(() => release, [release]);

    return { suspend, release };
}
