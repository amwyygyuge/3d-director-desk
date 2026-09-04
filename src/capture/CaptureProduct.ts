import type { HandoffBundle } from "@/capture/HandoffBundle";

export const CAPTURE_PRODUCT_KIND = {
    IMAGE: "image",
    VIDEO: "video",
} as const;

export type CaptureProductKind = (typeof CAPTURE_PRODUCT_KIND)[keyof typeof CAPTURE_PRODUCT_KIND];

/** 宿主消费的已完成采集产物；blobUrl 生命周期由产物接收方管理。 */
export interface CaptureProduct {
    readonly kind: CaptureProductKind;
    readonly mimeType: string;
    readonly blobUrl: string;
    readonly width: number;
    readonly height: number;
    readonly requestId: string;
    /** 视频为实际录制秒数；截图为 null。 */
    readonly durationSeconds: number | null;
    /** 交接包:合成文本条件 + 被摄体身份 + 呈现档;capture.bundle 产物携带,capture.frame/video 为空 */
    readonly bundle?: HandoffBundle;
}
