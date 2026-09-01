import { useCallback, useEffect, useRef, useState } from "react";

interface HoverIntentOptions {
    readonly openDelayMs: number;
    readonly closeDelayMs: number;
}

interface HoverIntentResult {
    readonly active: boolean;
    readonly handlers: {
        readonly onPointerEnter: () => void;
        readonly onPointerLeave: () => void;
    };
}

interface ScheduleOptions {
    readonly active: boolean;
    readonly delayMs: number;
}

/** 将短暂的指针掠过与明确停留区分开,避免壳层遮挡画布。 */
export function useHoverIntent(options: HoverIntentOptions): HoverIntentResult {
    const [active, setActive] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback((): void => {
        if (timerRef.current === null) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const schedule = useCallback(
        ({ active: nextActive, delayMs }: ScheduleOptions): void => {
            clearTimer();
            timerRef.current = setTimeout(() => {
                setActive(nextActive);
                timerRef.current = null;
            }, delayMs);
        },
        [clearTimer],
    );

    useEffect(() => clearTimer, [clearTimer]);

    return {
        active,
        handlers: {
            onPointerEnter: () => schedule({ active: true, delayMs: options.openDelayMs }),
            onPointerLeave: () => schedule({ active: false, delayMs: options.closeDelayMs }),
        },
    };
}
