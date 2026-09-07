import type { OutputFormat } from "@/output/OutputFormat";

const VIDEO_PIXEL_ALIGNMENT = 2;

export interface OutputFrameSize {
    readonly width: number;
    readonly height: number;
}

export interface OutputFrameRect extends OutputFrameSize {
    readonly x: number;
    readonly y: number;
}

export interface OutputFrameNdcBounds {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

function isSizeUsable(size: OutputFrameSize): boolean {
    return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

function centeredRect(size: OutputFrameSize, aspectRatio: number | null): OutputFrameRect | null {
    if (!isSizeUsable(size)) return null;
    if (aspectRatio === null) return { x: 0, y: 0, width: size.width, height: size.height };
    const sourceAspectRatio = size.width / size.height;
    const width = sourceAspectRatio > aspectRatio ? Math.floor(size.height * aspectRatio) : size.width;
    const height = sourceAspectRatio > aspectRatio ? size.height : Math.floor(size.width / aspectRatio);
    return {
        x: Math.floor((size.width - width) / 2),
        y: Math.floor((size.height - height) / 2),
        width,
        height,
    };
}

function alignedVideoRect(rect: OutputFrameRect): OutputFrameRect | null {
    const width = rect.width - (rect.width % VIDEO_PIXEL_ALIGNMENT);
    const height = rect.height - (rect.height % VIDEO_PIXEL_ALIGNMENT);
    if (width === 0 || height === 0) return null;
    return {
        x: rect.x + Math.floor((rect.width - width) / VIDEO_PIXEL_ALIGNMENT),
        y: rect.y + Math.floor((rect.height - height) / VIDEO_PIXEL_ALIGNMENT),
        width,
        height,
    };
}

/** 输出画幅值对象：把「当前 canvas + 目标比例」收敛成预览、测量和采集共用的中心裁切区域。 */
export class OutputFrameGeometry {
    readonly canvasSize: OutputFrameSize;
    readonly format: OutputFormat;
    readonly cropRect: OutputFrameRect | null;

    constructor(canvasSize: OutputFrameSize, format: OutputFormat) {
        this.canvasSize = { width: canvasSize.width, height: canvasSize.height };
        this.format = format;
        this.cropRect = centeredRect(canvasSize, format.aspectRatio);
        Object.freeze(this.canvasSize);
        Object.freeze(this);
    }

    get videoRect(): OutputFrameRect | null {
        return this.cropRect ? alignedVideoRect(this.cropRect) : null;
    }

    get ndcBounds(): OutputFrameNdcBounds | null {
        const crop = this.cropRect;
        if (!crop) return null;
        const left = (crop.x / this.canvasSize.width) * 2 - 1;
        const right = ((crop.x + crop.width) / this.canvasSize.width) * 2 - 1;
        const top = 1 - (crop.y / this.canvasSize.height) * 2;
        const bottom = 1 - ((crop.y + crop.height) / this.canvasSize.height) * 2;
        return { left, right, top, bottom };
    }
}
