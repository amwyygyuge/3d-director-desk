import Box from "@mui/material/Box";
import { observer } from "mobx-react-lite";
import type { CSSProperties } from "react";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { resolveShotFrameMode, ShotFrameOverlay } from "@/ui/viewport/ShotFrameOverlay";

const OUTPUT_FRAME_ASPECT_VARIABLE = "--output-frame-aspect";
const OUTPUT_FRAME_WIDTH_VARIABLE = "--output-frame-width";
const OUTPUT_FRAME_HEIGHT_VARIABLE = "--output-frame-height";
const FRAME_WIDTH = "min(100cqw, calc(100cqh * var(--output-frame-aspect)))";
const FRAME_HEIGHT = "min(100cqh, calc(100cqw / var(--output-frame-aspect)))";
const FRAME_LEFT = "calc((100cqw - var(--output-frame-width)) / 2)";
const FRAME_TOP = "calc((100cqh - var(--output-frame-height)) / 2)";
const FRAME_RIGHT = "calc(100cqw - var(--output-frame-width) - var(--output-frame-left))";
const FRAME_BOTTOM = "calc(100cqh - var(--output-frame-height) - var(--output-frame-top))";
const MATTE_COLOR = "rgba(0, 0, 0, 0.48)";
const GRID_LINE_COLOR = "rgba(255, 255, 255, 0.25)";
const GRID_LINE_POSITIONS = ["calc(100% / 3)", "calc(100% * 2 / 3)"] as const;

type OutputFrameStyle = CSSProperties & {
    readonly [OUTPUT_FRAME_ASPECT_VARIABLE]: string;
    readonly [OUTPUT_FRAME_WIDTH_VARIABLE]: string;
    readonly [OUTPUT_FRAME_HEIGHT_VARIABLE]: string;
    readonly "--output-frame-left": string;
    readonly "--output-frame-top": string;
    readonly "--output-frame-right": string;
    readonly "--output-frame-bottom": string;
};

type MatteSide = "top" | "bottom" | "left" | "right";

const MATTE_STYLE: Record<MatteSide, CSSProperties> = {
    top: { height: "var(--output-frame-top)", insetInline: 0, top: 0 },
    bottom: { bottom: 0, height: "var(--output-frame-bottom)", insetInline: 0 },
    left: {
        height: "var(--output-frame-height)",
        left: 0,
        top: "var(--output-frame-top)",
        width: "var(--output-frame-left)",
    },
    right: {
        height: "var(--output-frame-height)",
        right: 0,
        top: "var(--output-frame-top)",
        width: "var(--output-frame-right)",
    },
};

function outputFrameStyle(aspectRatio: number): OutputFrameStyle {
    return {
        [OUTPUT_FRAME_ASPECT_VARIABLE]: String(aspectRatio),
        [OUTPUT_FRAME_WIDTH_VARIABLE]: FRAME_WIDTH,
        [OUTPUT_FRAME_HEIGHT_VARIABLE]: FRAME_HEIGHT,
        "--output-frame-left": FRAME_LEFT,
        "--output-frame-top": FRAME_TOP,
        "--output-frame-right": FRAME_RIGHT,
        "--output-frame-bottom": FRAME_BOTTOM,
        containerType: "size",
    };
}

function renderOutputFrameMattes(): JSX.Element {
    return (
        <>
            {(Object.keys(MATTE_STYLE) as MatteSide[]).map((side) => (
                <div
                    key={side}
                    className="pointer-events-none absolute"
                    style={{ ...MATTE_STYLE[side], background: MATTE_COLOR }}
                />
            ))}
        </>
    );
}

function renderOutputFrameGrid(): JSX.Element {
    return (
        <>
            {GRID_LINE_POSITIONS.map((left) => (
                <div
                    key={left}
                    className="pointer-events-none absolute bottom-0 top-0 border-l"
                    style={{ borderColor: GRID_LINE_COLOR, left }}
                />
            ))}
            {GRID_LINE_POSITIONS.map((top) => (
                <div
                    key={top}
                    className="pointer-events-none absolute left-0 right-0 border-t"
                    style={{ borderColor: GRID_LINE_COLOR, top }}
                />
            ))}
        </>
    );
}

/** 目标画幅覆盖层：中心安全框、框外遮罩与三分格同用 OutputFormat 的比例语义。 */
export const OutputFrameOverlay = observer(function OutputFrameOverlay() {
    const { camera, layout, motionAuthoring, output } = useDirectorDeskStores();
    if (layout.isProgramTakeover) return null;
    const aspectRatio = output.format.aspectRatio;
    const isCropped = aspectRatio !== null;
    const isGuideVisible =
        isCropped ||
        resolveShotFrameMode(layout.isProgramTakeover, motionAuthoring.lensViewActive, camera.activeShotId) !== "none";
    const targetClassName = isCropped ? "absolute border border-white/50" : "absolute inset-0";
    const targetStyle = isCropped
        ? {
              height: "var(--output-frame-height)",
              left: "var(--output-frame-left)",
              top: "var(--output-frame-top)",
              width: "var(--output-frame-width)",
          }
        : undefined;
    return (
        <Box
            className="pointer-events-none absolute inset-0 z-[1]"
            {...(aspectRatio === null ? {} : { style: outputFrameStyle(aspectRatio) })}
        >
            {isCropped ? renderOutputFrameMattes() : null}
            <div data-helper="output-frame" className={targetClassName} style={targetStyle}>
                {layout.outputGridVisible && isGuideVisible ? renderOutputFrameGrid() : null}
                <ShotFrameOverlay />
            </div>
        </Box>
    );
});
