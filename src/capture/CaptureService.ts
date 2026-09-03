import { PerspectiveCamera, Vector3 } from "three";
import type { Box3, Camera, Scene, WebGLRenderer } from "three";

import { HelperVisibilityTransaction } from "@/capture/HelperVisibilityTransaction";
import type { CaptureHelperLifecycle } from "@/capture/HelperVisibilityTransaction";
import { waitMs } from "@/core/waitMs";
import type { Vec3 } from "@/core/SceneObject";

const PNG_MIME_TYPE = "image/png";
const TMP_DIRECTION = new Vector3();
const TMP_CORNER = new Vector3();
const NDC_EDGE = 1;
const TMP_SHOT_CAMERA = new PerspectiveCamera();
const VIDEO_FPS = 30;
/** 录制时长上限(秒):参考片段场景,防失控长录 */
export const VIDEO_MAX_DURATION_SECONDS = 120;
const VIDEO_MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"] as const;
/** 自然停止漏掉时的兜底尾部；正常结束由命令层观察播放停止后显式收口。 */
const VIDEO_TAIL_GRACE_MS = 1_000;

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

/** 视锥测量:包围盒投影到 NDC 的边距;负值 = 出画。AI「同框断言」的数据面,消灭布景链路的截图依赖 */
export interface FramingMeasure {
    readonly inFrame: boolean;
    /** 四边到视口边缘的最小余量(NDC 单位,-1~1 轴向) */
    readonly marginNdc: number;
}

/** 机位解析式取景输入:check-framing 断言按机位定义测量,不等渲染相机下一帧 */
export interface ShotFramingPose {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number | null;
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
    private recordingEndSignal: ((discard: boolean) => void) | null = null;
    private activeRecording: Promise<Blob | null> | null = null;
    private recordedMimeType: string | null = null;

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

    /** 最近一次成功启动的 MediaRecorder 实际编码；产品协议禁止猜测 MIME。 */
    get lastVideoMimeType(): string | null {
        return this.recordedMimeType;
    }

    /**
     * 包围盒八顶点投影 NDC,量出画边距;未 attach 或空盒返回 null。查询低频,不在渲染热路径。
     * pose 缺省读当前生效相机;传入机位位姿则按机位解析式测量——
     * camera.activate 的写入下一帧才到渲染相机,同任务内的「机位→同框断言」链必须用后者。
     */
    measureFraming(box: Box3, pose?: ShotFramingPose): FramingMeasure | null {
        if (box.isEmpty()) return null;
        const canvas = this.handles?.gl.domElement;
        if (pose && canvas) {
            TMP_SHOT_CAMERA.position.set(...pose.position);
            TMP_SHOT_CAMERA.up.set(0, 1, 0);
            TMP_SHOT_CAMERA.lookAt(...pose.target);
            TMP_SHOT_CAMERA.fov = pose.fov ?? TMP_SHOT_CAMERA.fov; // fov null 时沿用 50° 默认
            TMP_SHOT_CAMERA.aspect = canvas.width / canvas.height;
            TMP_SHOT_CAMERA.updateProjectionMatrix();
            TMP_SHOT_CAMERA.updateMatrixWorld(true);
            return this.measureFramingWith(TMP_SHOT_CAMERA, box);
        }
        const camera = this.handles?.camera;
        if (!camera) return null;
        return this.measureFramingWith(camera, box);
    }

    private measureFramingWith(camera: Camera, box: Box3): FramingMeasure {
        const corners = [box.min.x, box.max.x].flatMap((x) =>
            [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => [x, y, z] as const)),
        );
        const extents = corners.reduce(
            (acc, [x, y, z]) => {
                TMP_CORNER.set(x, y, z).project(camera);
                return {
                    minX: Math.min(acc.minX, TMP_CORNER.x),
                    maxX: Math.max(acc.maxX, TMP_CORNER.x),
                    minY: Math.min(acc.minY, TMP_CORNER.y),
                    maxY: Math.max(acc.maxY, TMP_CORNER.y),
                };
            },
            { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
        );
        const marginNdc = Math.min(
            extents.minX + NDC_EDGE,
            NDC_EDGE - extents.maxX,
            extents.minY + NDC_EDGE,
            NDC_EDGE - extents.maxY,
        );
        return { inFrame: marginNdc >= 0, marginNdc };
    }

    /**
     * 录制画布为 WebM 视频:canvas.captureStream 帧流 + MediaRecorder。
     * 正常收口由命令层在播放停下时 stopRecording；墙钟只防止外部驱动失联后无限录制。
     */
    recordVideo(options: { readonly durationSeconds: number; readonly hideHelpers?: boolean }): Promise<Blob | null> {
        const handles = this.handles;
        if (!handles || this.recorder) return Promise.resolve(null);
        const stream = handles.gl.domElement.captureStream(VIDEO_FPS);
        const preferredMimeType =
            VIDEO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
        const helperVisibility = new HelperVisibilityTransaction();
        if (options.hideHelpers) helperVisibility.hide(handles.scene);
        const { promise: endRequested, resolve: requestEnd } = Promise.withResolvers<boolean>();
        const { promise: stopped, resolve: markStopped } = Promise.withResolvers<void>();
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => markStopped();
        this.recorder = recorder;
        this.recordingEndSignal = requestEnd;
        this.recordedMimeType = recorder.mimeType;
        recorder.start();
        const recording = this.collectVideo({
            recorder,
            stream,
            endRequested,
            stopped,
            chunks,
            helperVisibility,
            durationSeconds: options.durationSeconds,
        });
        this.activeRecording = recording;
        return recording;
    }

    /** 明确结束采集并保留 chunks；返回同一个产物 Promise 供非命令调用方等待。 */
    stopRecording(): Promise<Blob | null> {
        this.recordingEndSignal?.(false);
        return this.activeRecording ?? Promise.resolve(null);
    }

    /** 明确放弃本次采集；录制任务仍负责释放 MediaRecorder 与可见性事务。 */
    cancelRecording(): Promise<Blob | null> {
        this.recordingEndSignal?.(true);
        return this.activeRecording ?? Promise.resolve(null);
    }

    private async collectVideo(options: {
        readonly recorder: MediaRecorder;
        readonly stream: MediaStream;
        readonly endRequested: Promise<boolean>;
        readonly stopped: Promise<void>;
        readonly chunks: Blob[];
        readonly helperVisibility: HelperVisibilityTransaction;
        readonly durationSeconds: number;
    }): Promise<Blob | null> {
        try {
            const discard = await Promise.race([
                options.endRequested,
                waitMs(options.durationSeconds * 1_000 + VIDEO_TAIL_GRACE_MS).then(() => false),
            ]);
            options.recorder.stop();
            await options.stopped;
            const mimeType = options.recorder.mimeType;
            this.recordedMimeType = mimeType;
            return discard ? null : new Blob(options.chunks, { type: mimeType });
        } finally {
            for (const track of options.stream.getTracks()) track.stop();
            this.restoreHelpers(options.helperVisibility);
            this.recorder = null;
            this.recordingEndSignal = null;
            this.activeRecording = null;
        }
    }

    private restoreHelpers(transaction: HelperVisibilityTransaction): void {
        this.currentHelperLifecycle = transaction.restore();
        const handles = this.handles;
        if (!handles || this.currentHelperLifecycle.hiddenHelperCount === 0) return;
        handles.gl.render(handles.scene, handles.camera);
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

        const helperVisibility = new HelperVisibilityTransaction();
        if (options?.hideHelpers !== false) helperVisibility.hide(scene);
        gl.render(scene, camera);
        const dataUrl = gl.domElement.toDataURL(PNG_MIME_TYPE);
        this.currentHelperLifecycle = helperVisibility.restore();
        if (this.currentHelperLifecycle.hiddenHelperCount > 0) gl.render(scene, camera);
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
