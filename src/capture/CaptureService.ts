import type { Camera, Scene, WebGLRenderer } from "three";
import type { Object3D } from "three";

const PNG_MIME_TYPE = "image/png";

/** 渲染句柄:R3F onCreated 时注入;three 运行时引用,普通字段不进 observable */
export interface RenderHandles {
    gl: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    invalidate: () => void;
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
    private generation = 0;

    attach(handles: RenderHandles): void {
        this.generation += 1;
        this.handles = handles;
    }

    detach(): void {
        this.generation += 1;
        this.handles = null;
    }

    get isAttached(): boolean {
        return this.handles !== null;
    }

    /** 画布物理像素尺寸(协议 payload 用) */
    get size(): { width: number; height: number } | null {
        const canvas = this.handles?.gl.domElement;
        return canvas ? { width: canvas.width, height: canvas.height } : null;
    }

    /** 截取当前场景为 PNG blob;hideHelpers 默认开(网格/gizmo/高亮框不入镜) */
    async capture(options?: { hideHelpers?: boolean }): Promise<Blob | null> {
        const handles = this.handles;
        const generation = this.generation;
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
        if (options?.hideHelpers !== false) {
            scene.traverse((object) => {
                if (object.userData.helper === true && object.visible) {
                    object.visible = false;
                    hidden.push(object);
                }
            });
        }

        gl.render(scene, camera);
        const { promise, resolve } = Promise.withResolvers<Blob | null>();
        gl.domElement.toBlob(
            (blob) => resolve(this.isCurrentCapture(handles, generation) ? blob : null),
            PNG_MIME_TYPE,
        );

        for (const object of hidden) object.visible = true;
        if (hidden.length > 0) gl.render(scene, camera);
        return promise;
    }

    private isCurrentCapture(handles: RenderHandles, generation: number): boolean {
        return this.handles === handles && this.generation === generation;
    }
}
