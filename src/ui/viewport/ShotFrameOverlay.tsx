import Button from "@mui/material/Button";
import { observer } from "mobx-react-lite";

import type { CameraKeyJSON } from "@/camera/CameraKey";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { DirectorPose } from "@/store/CameraStore";
import { MONO_FONT_STACK } from "@/ui/shell/theme";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { ViewportToast } from "@/ui/workspace/ViewportToast";

const FRAME_INSET_CLASS = "absolute inset-3";
const GRID_LINE_CLASS = "border-white/25";
const TAKE_DURATION_SECONDS = 1;
const NO_CLIP_MESSAGE = "当前时间没有镜头片段";

type FrameMode = "shot" | "lens" | "none";

interface FrameStyle {
    readonly borderClassName: string;
    readonly labelClassName: string;
}

const FRAME_STYLE: Record<Exclude<FrameMode, "none">, FrameStyle> = {
    shot: { borderClassName: "border-amber-200/70", labelClassName: "text-amber-200/90" },
    lens: { borderClassName: "border-indigo-300/90", labelClassName: "text-indigo-200" },
};

function resolveFrameMode(presentationMode: boolean, lensViewActive: boolean, activeShotId: string | null): FrameMode {
    if (presentationMode) return "none";
    if (lensViewActive) return "lens";
    return activeShotId === null ? "none" : "shot";
}

/** 生效片段的裁决与采样器/打点服务同源:取景框角标不得自成一套判据。 */
function clipAtLensTime(
    stores: DirectorDeskStores,
    timeSeconds: number,
): { readonly id: string; readonly cameraId: string } | null {
    return stores.motion.resolveOutputClipAt(timeSeconds, stores.motionAuthoring.previewClipId);
}

function keyAtPose(id: string, progress: number, pose: DirectorPose): CameraKeyJSON {
    return {
        id,
        progress,
        position: pose.position,
        target: pose.target,
        fov: pose.fov,
        inHandle: [0, 0, 0],
        outHandle: [0, 0, 0],
        handleMode: MOTION_HANDLE_MODE.AUTO,
    };
}

/** 唯一随 playhead 更新的取景框文字叶子,避免框线/父视口壳层跟帧重建。 */
const LensFrameLabel = observer(function LensFrameLabel() {
    const stores = useDirectorDeskStores();
    const timeSeconds = stores.playheadDisplay.value;
    const clip = clipAtLensTime(stores, timeSeconds);
    const cameraLabel = clip?.cameraId ?? "—";
    return (
        <span className="absolute left-5 top-20 text-xs text-indigo-200">
            镜头 · {cameraLabel} · t={timeSeconds.toFixed(2)}s
        </span>
    );
});

/** 镜头视角在片段空档给出可执行的下一步,但不在帧级父层读取 playhead。 */
const LensNoClipToast = observer(function LensNoClipToast() {
    const stores = useDirectorDeskStores();
    const timeSeconds = stores.playheadDisplay.value;
    const clip = clipAtLensTime(stores, timeSeconds);
    const preview = stores.motionAuthoring.previewClipId
        ? stores.motion.clip(stores.motionAuthoring.previewClipId)
        : undefined;
    const selectedId = stores.selection.primaryId;
    const selectedCameraId = selectedId && stores.camera.director.getShot(selectedId) ? selectedId : null;
    const cameraId = preview?.cameraId ?? selectedCameraId;
    const pose = stores.camera.lastDirectorPose;
    const canCreateTake = clip === null && cameraId !== null && pose !== null;

    const createTake = (): void => {
        if (!cameraId || !pose) return;
        const result = stores.dispatcher.dispatch(
            {
                type: "motion.create-take",
                payload: {
                    id: crypto.randomUUID(),
                    cameraId,
                    startTimeSeconds: stores.clock.time,
                    durationSeconds: TAKE_DURATION_SECONDS,
                    keys: [keyAtPose(crypto.randomUUID(), 0, pose), keyAtPose(crypto.randomUUID(), 1, pose)],
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <ViewportToast open={clip === null}>
            <span>{NO_CLIP_MESSAGE}</span>
            <Button
                size="small"
                color="inherit"
                disabled={!canCreateTake}
                onClick={createTake}
                sx={{ ml: 1, pointerEvents: "auto" }}
            >
                在此创建 1 秒片段
            </Button>
        </ViewportToast>
    );
});

/** 三态视口取景框:掌镜写静态机位,镜头视角写当前 CameraKey,导演/全屏态不渲染。 */
export const ShotFrameOverlay = observer(function ShotFrameOverlay() {
    const { camera, layout, motionAuthoring } = useDirectorDeskStores();
    const mode = resolveFrameMode(layout.presentationMode, motionAuthoring.lensViewActive, camera.activeShotId);
    if (mode === "none") return null;
    const style = FRAME_STYLE[mode];
    const isLens = mode === "lens";
    return (
        <>
            <div data-helper="shot-frame" className="pointer-events-none absolute inset-0 z-[1]">
                <div className={`${FRAME_INSET_CLASS} border ${style.borderClassName}`} />
                <div
                    className={`absolute top-3 bottom-3 border-l ${GRID_LINE_CLASS}`}
                    style={{ left: "calc(0.75rem + (100% - 1.5rem) / 3)" }}
                />
                <div
                    className={`absolute top-3 bottom-3 border-l ${GRID_LINE_CLASS}`}
                    style={{ left: "calc(0.75rem + (100% - 1.5rem) * 2 / 3)" }}
                />
                <div
                    className={`absolute left-3 right-3 border-t ${GRID_LINE_CLASS}`}
                    style={{ top: "calc(0.75rem + (100% - 1.5rem) / 3)" }}
                />
                <div
                    className={`absolute left-3 right-3 border-t ${GRID_LINE_CLASS}`}
                    style={{ top: "calc(0.75rem + (100% - 1.5rem) * 2 / 3)" }}
                />
                {isLens ? (
                    <LensFrameLabel />
                ) : (
                    <span
                        className={`absolute left-5 top-20 text-xs ${style.labelClassName}`}
                        style={{ fontFamily: MONO_FONT_STACK }}
                    >
                        {camera.activeShotId} · 静态
                    </span>
                )}
            </div>
            {isLens ? <LensNoClipToast /> : null}
        </>
    );
});
