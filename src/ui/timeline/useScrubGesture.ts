import { useRef } from "react";
import type { PointerEvent, RefObject } from "react";

/** 归一化位置 → 时间的换算基准;0 宽轨道不参与换算,避免除零。 */
const EMPTY_TRACK_WIDTH = 0;

export interface ScrubGestureOptions {
    /** 被拖动的轨道元素;宽度即时间轴的像素跨度 */
    readonly trackRef: RefObject<HTMLElement | null>;
    /** 归一化位置 0~1;调用方负责换算成秒并经命令层落地 */
    readonly onScrub: (ratio: number) => void;
}

export interface ScrubGestureHandlers {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}

/**
 * 轨道拖拽定位手势(迷你播放条与展开态标尺共用,Rule of Two)。
 *
 * 只在自己按下时接管:标尺同时承载关键帧拖拽的指针捕获,拖关键帧产生的
 * pointermove 会路由到同一元素上——内部的 scrubbing 标记保证两种手势互不串台。
 * 拖动过程直接发 transport.seek(瞬态命令,不入撤销栈),不缓存中间态。
 */
export function useScrubGesture({ trackRef, onScrub }: ScrubGestureOptions): ScrubGestureHandlers {
    const scrubbing = useRef(false);

    const scrubAt = (event: PointerEvent<HTMLElement>): void => {
        const bounds = trackRef.current?.getBoundingClientRect();
        if (!bounds || bounds.width === EMPTY_TRACK_WIDTH) return;
        onScrub(Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1));
    };

    const end = (event: PointerEvent<HTMLElement>): void => {
        if (!scrubbing.current) return;
        scrubbing.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    return {
        onPointerDown: (event) => {
            scrubbing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubAt(event);
        },
        onPointerMove: (event) => {
            if (scrubbing.current) scrubAt(event);
        },
        onPointerUp: end,
        onPointerCancel: end,
    };
}
