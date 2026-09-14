import { makeAutoObservable } from "mobx";
import { OutputFrameGeometry } from "@/output/OutputFrameGeometry";
import type { OutputFrameSize } from "@/output/OutputFrameGeometry";

export const OUTPUT_FORMAT = {
    AUTO: "auto",
    ULTRAWIDE: "21:9",
    WIDESCREEN: "16:9",
    STANDARD: "4:3",
    SQUARE: "1:1",
    PORTRAIT_STANDARD: "3:4",
    PORTRAIT: "9:16",
} as const;

export type OutputFormatId = (typeof OUTPUT_FORMAT)[keyof typeof OUTPUT_FORMAT];

interface OutputFormatDefinition {
    readonly label: string;
    readonly aspectWidth: number | null;
    readonly aspectHeight: number | null;
}

const OUTPUT_FORMAT_DEFINITIONS: Record<OutputFormatId, OutputFormatDefinition> = {
    [OUTPUT_FORMAT.AUTO]: { label: "自适应", aspectWidth: null, aspectHeight: null },
    [OUTPUT_FORMAT.ULTRAWIDE]: { label: "21:9", aspectWidth: 21, aspectHeight: 9 },
    [OUTPUT_FORMAT.WIDESCREEN]: { label: "16:9", aspectWidth: 16, aspectHeight: 9 },
    [OUTPUT_FORMAT.STANDARD]: { label: "4:3", aspectWidth: 4, aspectHeight: 3 },
    [OUTPUT_FORMAT.SQUARE]: { label: "1:1", aspectWidth: 1, aspectHeight: 1 },
    [OUTPUT_FORMAT.PORTRAIT_STANDARD]: { label: "3:4", aspectWidth: 3, aspectHeight: 4 },
    [OUTPUT_FORMAT.PORTRAIT]: { label: "9:16", aspectWidth: 9, aspectHeight: 16 },
};

export const OUTPUT_FORMAT_ORDER: readonly OutputFormatId[] = [
    OUTPUT_FORMAT.AUTO,
    OUTPUT_FORMAT.ULTRAWIDE,
    OUTPUT_FORMAT.WIDESCREEN,
    OUTPUT_FORMAT.STANDARD,
    OUTPUT_FORMAT.SQUARE,
    OUTPUT_FORMAT.PORTRAIT_STANDARD,
    OUTPUT_FORMAT.PORTRAIT,
];

/** 成片画幅值对象：只描述比例，不持有宿主尺寸或 Three 运行时引用。 */
export class OutputFormat {
    readonly id: OutputFormatId;
    readonly label: string;
    readonly aspectWidth: number | null;
    readonly aspectHeight: number | null;

    constructor(id: OutputFormatId) {
        const definition = OUTPUT_FORMAT_DEFINITIONS[id];
        this.id = id;
        this.label = definition.label;
        this.aspectWidth = definition.aspectWidth;
        this.aspectHeight = definition.aspectHeight;
        Object.freeze(this);
    }

    get aspectRatio(): number | null {
        const { aspectHeight, aspectWidth } = this;
        return aspectWidth === null || aspectHeight === null ? null : aspectWidth / aspectHeight;
    }
}

const OUTPUT_FORMATS: Record<OutputFormatId, OutputFormat> = OUTPUT_FORMAT_ORDER.reduce<
    Record<OutputFormatId, OutputFormat>
>((formats, id) => ({ ...formats, [id]: new OutputFormat(id) }), {} as Record<OutputFormatId, OutputFormat>);

export function isOutputFormatId(value: unknown): value is OutputFormatId {
    return typeof value === "string" && Object.hasOwn(OUTPUT_FORMAT_DEFINITIONS, value);
}

export function outputFormatFor(id: OutputFormatId): OutputFormat {
    return OUTPUT_FORMATS[id];
}

/** 画幅未定时的焦距换算回落比例:16:9 是最常见的成片比例。 */
export const DEFAULT_OUTPUT_ASPECT_RATIO = 16 / 9;

/** 项目级输出聚合：UI、宿主与 AI 通过命令统一修改，比例可 JSON 往返。 */
export class OutputSettings {
    formatId: OutputFormatId = OUTPUT_FORMAT.AUTO;

    constructor() {
        makeAutoObservable(this);
    }

    get format(): OutputFormat {
        return outputFormatFor(this.formatId);
    }

    setFormat(id: OutputFormatId): void {
        this.formatId = id;
    }

    frameFor(canvasSize: OutputFrameSize | null): OutputFrameGeometry | null {
        return canvasSize ? new OutputFrameGeometry(canvasSize, this.format) : null;
    }

    /**
     * 成片画幅的宽高比数值(焦距换算唯一口径)。
     *
     * 焦距是 fov 的派生视图,换算必须带宽高比(同一支 50mm 在 16:9 与 1:1 上视场角不同)。
     * 命令层与检查器**必须共用本方法**:两处各写一份必然出现「界面标 50mm、命令按别的画幅算」。
     * 自适应画幅下裁切区即整块画布,故回落到画布比例;画布未就绪时给 16:9(最常见的成片比例)。
     */
    aspectRatioFor(canvasSize: OutputFrameSize | null): number {
        const crop = this.frameFor(canvasSize)?.cropRect;
        return crop && crop.height > 0 ? crop.width / crop.height : DEFAULT_OUTPUT_ASPECT_RATIO;
    }
}
