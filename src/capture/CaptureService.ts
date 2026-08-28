/**
 * 预演画面输出服务(应用服务):截图与录屏。
 * 截图需要 preserveDrawingBuffer 或渲染后立即取样——由调用方在渲染帧回调内触发,
 * 本类不持有 canvas,只封装编码与导出。
 */
export class CaptureService {
    /** 截取当前帧为 PNG blob;必须在刚渲染完的同一帧内调用 */
    captureFrame(canvas: HTMLCanvasElement): Promise<Blob | null> {
        const { promise, resolve } = Promise.withResolvers<Blob | null>();
        canvas.toBlob((blob) => resolve(blob), "image/png");
        return promise;
    }
}
