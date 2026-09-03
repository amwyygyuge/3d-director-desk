import { PerspectiveCamera, Vector3 } from "three";
import type { Box3, Camera, Scene, WebGLRenderer } from "three";

import { CaptureHelperRegistry } from "@/capture/CaptureHelperRegistry";
import { DeterministicMp4Exporter } from "@/capture/DeterministicMp4Exporter";
import type { DeterministicMp4ExportResult } from "@/capture/DeterministicMp4Exporter";
import { HelperVisibilityTransaction } from "@/capture/HelperVisibilityTransaction";
import type { CaptureHelperLifecycle } from "@/capture/HelperVisibilityTransaction";
import type { Vec3 } from "@/core/SceneObject";

const PNG_MIME_TYPE = "image/png";
const TMP_DIRECTION = new Vector3();
const TMP_CORNER = new Vector3();
const NDC_EDGE = 1;
const TMP_SHOT_CAMERA = new PerspectiveCamera();
/** 录制时长上限(秒):参考片段场景,防失控长录 */
export const VIDEO_MAX_DURATION_SECONDS = 120;

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
 * 预演画面输出服务(应用服务):截图与确定性 MP4 参考视频。
 *
 * 截图在单个 JS 任务内强制渲一帧再取样；视频按项目帧率逐帧 seek、渲染与编码，
 * 因而设备性能只影响导出耗时，不改变模型收到的帧序列。
 * 编辑期 helper 根登记到 CaptureHelperRegistry；采集只迭代这些根，不遍历场景树。
 */
export class CaptureService {
    private handles: RenderHandles | null = null;
    private currentHelperLifecycle: CaptureHelperLifecycle | null = null;
    /** 编辑期辅助物根的运行时注册表；Three 引用不进 MobX，采集可直接迭代。 */
    readonly helpers = new CaptureHelperRegistry();
    private exporter: DeterministicMp4Exporter | null = null;
    private activeVideoExport: Promise<DeterministicMp4ExportResult | null> | null = null;
    private recordedMimeType: string | null = null;

    attach(handles: RenderHandles): void {
        this.handles = handles;
    }

    detach(): void {
        this.handles = null;
    }
    dispose(): void {
        this.exporter?.requestCancel();
        this.helpers.clear();
        this.detach();
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
        return this.exporter !== null;
    }

    /** 最近一次成功导出的实际 MIME；产品协议禁止猜测编码。 */
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
     * 固定帧率导出 H.264/MP4 参考视频；每一帧先由命令层采样时间轴，再立即渲染并编码。
     * Stop 在当前帧边界完成并交付，Cancel 丢弃产物；两条路径均复原 helper 可见性。
     */
    exportVideo(options: {
        readonly durationSeconds: number;
        readonly frameRate: number;
        readonly hideHelpers?: boolean;
        readonly renderFrame: (timeSeconds: number) => void;
    }): Promise<DeterministicMp4ExportResult | null> {
        const handles = this.handles;
        if (!handles || this.exporter) return Promise.resolve(null);
        const helperVisibility = new HelperVisibilityTransaction();
        if (options.hideHelpers) helperVisibility.hide(this.helpers);
        const exporter = new DeterministicMp4Exporter({
            canvas: handles.gl.domElement,
            durationSeconds: options.durationSeconds,
            frameRate: options.frameRate,
            renderFrame: (timeSeconds) => {
                options.renderFrame(timeSeconds);
                handles.gl.render(handles.scene, handles.camera);
            },
        });
        this.exporter = exporter;
        const videoExport = this.collectVideoExport({ exporter, helperVisibility });
        this.activeVideoExport = videoExport;
        return videoExport;
    }

    /** 在当前已完成帧之后收口并交付 MP4。 */
    stopVideoExport(): Promise<DeterministicMp4ExportResult | null> {
        this.exporter?.requestStop();
        return this.activeVideoExport ?? Promise.resolve(null);
    }

    /** 放弃当前导出，编码器与 helper 可见性事务仍由会话负责释放。 */
    cancelVideoExport(): Promise<DeterministicMp4ExportResult | null> {
        this.exporter?.requestCancel();
        return this.activeVideoExport ?? Promise.resolve(null);
    }

    private async collectVideoExport(options: {
        readonly exporter: DeterministicMp4Exporter;
        readonly helperVisibility: HelperVisibilityTransaction;
    }): Promise<DeterministicMp4ExportResult | null> {
        try {
            const result = await options.exporter.export();
            this.recordedMimeType = result?.blob.type ?? null;
            return result;
        } finally {
            this.restoreHelpers(options.helperVisibility);
            this.exporter = null;
            this.activeVideoExport = null;
        }
    }

    private restoreHelpers(transaction: HelperVisibilityTransaction): void {
        this.currentHelperLifecycle = transaction.restore();
        const handles = this.handles;
        if (!handles || this.currentHelperLifecycle.hiddenHelperCount === 0) return;
        handles.gl.render(handles.scene, handles.camera);
    }

    /** 截取当前场景为 PNG blob;hideHelpers 默认开(gizmo/高亮框等编辑辅助物不入镜) */
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
        if (options?.hideHelpers !== false) helperVisibility.hide(this.helpers);
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
