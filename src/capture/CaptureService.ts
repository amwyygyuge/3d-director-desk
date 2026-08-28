/**
 * 预演画面输出服务(应用服务):截图与录屏。
 * 截图需要 preserveDrawingBuffer 或渲染后立即取样。
 *
 * 挂载纪律:canvas 是 three 运行时引用,由 Canvas onCreated 注册进来(普通字段,
 * 不进 observable);命令层经 DirectorContext.capture 触达本服务——
 * AI「截图」指令的落地路径。
 */
export class CaptureService {
    private canvas: HTMLCanvasElement | null = null;

    attach(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
    }

    detach(): void {
        this.canvas = null;
    }

    /** 截取当前帧为 PNG blob;必须在刚渲染完的同一帧内调用 */
    capture(): Promise<Blob | null> {
        const { promise, resolve } = Promise.withResolvers<Blob | null>();
        if (!this.canvas) {
            resolve(null);
            return promise;
        }
        this.canvas.toBlob((blob) => resolve(blob), "image/png");
        return promise;
    }
}
