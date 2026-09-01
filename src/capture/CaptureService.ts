import { PerspectiveCamera, Vector3 } from "three";

import { waitMs } from "@/core/waitMs";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { Object3D } from "three";

import type { Vec3 } from "@/core/SceneObject";

const PNG_MIME_TYPE = "image/png";
const TMP_DIRECTION = new Vector3();
const VIDEO_FPS = 30;
/** 录制时长上限(秒):参考片段场景,防失控长录 */
export const VIDEO_MAX_DURATION_SECONDS = 120;
const VIDEO_MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"] as const;

/** agent 可读的生效相机位姿(纯数据,可序列化) */
export interface LiveCameraPose {
    readonly position: Vec3;
    readonly direction: Vec3;
    readonly fov: number | null;
}

/** 渲染句柄:R3F onCreated 时注入;three 运行时引用,普通字段不进 observable */
export interface RenderHandles {
    gl: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    invalidate: () => void;
}

/** Runtime-only observation of the most recent capture helper hide/restore transaction. */
export interface CaptureHelperLifecycle {
    readonly hiddenHelperCount: number;
    readonly hiddenPoseHelperCount: number;
    readonly helpersRestored: boolean;
}

/**
 * 预演画面输出服务(应用服务):截图与(后置)录屏。
 *
 * 帧内取样纪律(性能铁律):不需要常驻 preserveDrawingBuffer——
 * capture 在单个 JS 任务内 强制渲一帧 → toBlob 取样 → 恢复辅助物 → 再渲回可视帧,
 * 屏幕永不露出"去辅助物"的中间帧,demand 模式也能出图。
 *
 * 辅助物约定:Grid/BoxHelper/gizmo 等打 userData.helper = true 标记,隐藏靠查表遍历一次。
 * 命令层经 DirectorContext.capture 触达——AI「截图」指令的落地路径。
 */
export class CaptureService {
    private handles: RenderHandles | null = null;
    private currentHelperLifecycle: CaptureHelperLifecycle | null = null;
    private recorder: MediaRecorder | null = null;
    private cancelSignal: (() => void) | null = null;

    attach(handles: RenderHandles): void {
        this.handles = handles;
    }

    detach(): void {
        this.handles = null;
    }

    get isAttached(): boolean {
        return this.handles !== null;
    }

    get lastHelperLifecycle(): CaptureHelperLifecycle | null {
        return this.currentHelperLifecycle;
    }

    /** 画布物理像素尺寸(协议 payload 用) */
    get size(): { width: number; height: number } | null {
        const canvas = this.handles?.gl.domElement;
        return canvas ? { width: canvas.width, height: canvas.height } : null;
    }
    /** 当前生效相机位姿(R3F 默认相机,运镜 sink 写入的就是它);未 attach 返回 null */
    readCameraPose(): LiveCameraPose | null {
        const camera = this.handles?.camera;
        if (!camera) return null;
        const direction = camera.getWorldDirection(TMP_DIRECTION);
        return {
            position: camera.position.toArray() as Vec3,
            direction: direction.toArray() as Vec3,
            fov: camera instanceof PerspectiveCamera ? camera.fov : null,
        };
    }
    get isRecording(): boolean {
        return this.recorder !== null;
    }

    /**
     * 录制画布为 WebM 视频:canvas.captureStream 帧流 + MediaRecorder。
     * 播放驱动由命令层负责(seek(0)+play);本服务只管画面采集。
     * 取消经 cancelRecording:提前停录且返回 null(产物不交付)。
     */
    async recordVideo(options: { durationSeconds: number }): Promise<Blob | null> {
        const handles = this.handles;
        if (!handles || this.recorder) return null;
        const stream = handles.gl.domElement.captureStream(VIDEO_FPS);
        const mimeType =
            VIDEO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        const { promise: stopped, resolve: markStopped } = Promise.withResolvers<void>();
        const { promise: cancelled, resolve: fireCancel } = Promise.withResolvers<void>();
        this.cancelSignal = fireCancel;
        this.recorder = recorder;
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => markStopped();
        recorder.start();
        await Promise.race([waitMs(options.durationSeconds * 1000), cancelled]);
        const wasCancelled = this.cancelSignal === null;
        recorder.stop();
        await stopped;
        for (const track of stream.getTracks()) track.stop();
        this.recorder = null;
        this.cancelSignal = null;
        return wasCancelled ? null : new Blob(chunks, { type: mimeType });
    }

    /** 提前终止录制;产物丢弃(返回 null 路径) */
    cancelRecording(): void {
        const signal = this.cancelSignal;
        this.cancelSignal = null;
        signal?.();
    }

    /** 截取当前场景为 PNG blob;hideHelpers 默认开(网格/gizmo/高亮框不入镜) */
    async capture(options?: { hideHelpers?: boolean }): Promise<Blob | null> {
        const handles = this.handles;
        if (!handles) return null;
        const { gl, scene, camera } = handles;
        // 诊断(dev only,构建期消除):截图所用相机的实际投影参数
        if (import.meta.env.DEV) {
            const persp = camera as { isPerspectiveCamera?: boolean; fov?: number; aspect?: number };
            console.debug("[capture] camera", {
                pos: camera.position.toArray().map((v) => +v.toFixed(2)),
                fov: persp.fov,
                aspect: persp.aspect,
                canvas: [gl.domElement.width, gl.domElement.height],
            });
        }

        const hidden: Object3D[] = [];
        let hiddenPoseHelperCount = 0;
        if (options?.hideHelpers !== false) {
            scene.traverse((object) => {
                if (object.userData.helper === true && object.visible) {
                    object.visible = false;
                    hidden.push(object);
                    if (object.userData.poseHelper === true) hiddenPoseHelperCount += 1;
                }
            });
        }

        gl.render(scene, camera);
        const dataUrl = gl.domElement.toDataURL(PNG_MIME_TYPE);

        for (let index = 0; index < hidden.length; index += 1) {
            const object = hidden[index];
            if (object) object.visible = true;
        }
        this.currentHelperLifecycle = Object.freeze({
            hiddenHelperCount: hidden.length,
            hiddenPoseHelperCount,
            helpersRestored: hidden.every((object) => object.visible),
        });
        if (hidden.length > 0) gl.render(scene, camera);
        // toBlob 是异步的,读到的必是合成器残留帧;toDataURL 同步取值才满足单任务纪律
        return Promise.resolve(dataUrlToBlob(dataUrl));
    }
}

/** dataURL → Blob(同步,不触碰网络/任务队列) */
function dataUrlToBlob(dataUrl: string): Blob {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: PNG_MIME_TYPE });
}
