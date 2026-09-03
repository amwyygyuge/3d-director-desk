import type { ReactNode } from "react";

/** 内置缺省文案:宿主未定制时的回落基线(向后兼容契约,改动即破坏默认形态) */
const DEFAULT_TEXT = {
    PRODUCT_NAME: "3D 导演台",
    CAPTURE_IMAGE_TOOLTIP: "截图",
    CAPTURE_VIDEO_ARIA: "导出成片",
    DISCARD_RECORDING: "放弃录制",
    STOP_RECORDING: "停止并交付",
    RECORDING_TOOLTIP_PREFIX: "导出 Program 输出轨(",
    RECORDING_TOOLTIP_SUFFIX: "s)为 WebM",
} as const;

/** 截图动作文案定制:label 提供时按钮升级为「图标+文案」,缺省保持纯图标 */
export interface CaptureActionPresentationInit {
    /** 可见文案,兼作 aria-label;缺省 = 纯图标 + 内置 aria */
    readonly label?: string;
    /** 悬浮提示;缺省 = 内置文案 */
    readonly tooltip?: string;
}

/** 视频导出动作定制:HUD 的交付/放弃动作分别走 stopLabel/discardLabel。 */
export interface CaptureVideoPresentationInit extends CaptureActionPresentationInit {
    /** 成片交付动作的文案;缺省 "停止并交付"。 */
    readonly stopLabel?: string;
    /** 丢弃当前录制的动作文案;缺省 "放弃录制"。 */
    readonly discardLabel?: string;
}

/** 工具栏外部接入按钮(值对象入参);仅直嵌形态可用——ReactNode/回调过不了 postMessage */
export interface ToolbarExtensionInit {
    /** 稳定标识(React key + 去重判据) */
    readonly key: string;
    /** 图标节点;文字按钮形态下由 MUI startIcon 统一尺寸,纯图标形态建议 MUI 图标带 fontSize="small" 对齐内置按钮 */
    readonly icon: ReactNode;
    /** 可见文案,兼作 aria-label 与缺省 tooltip;缺省 = 纯图标形态(窗口控制类按钮的典型形态) */
    readonly label?: string;
    /** 悬浮提示;label 缺省时兼任 aria-label——label 与 tooltip 至少给一个,全空视为非法条目被过滤 */
    readonly tooltip?: string;
    /** 点击回调:宿主全接管,组件不拦截、不附加默认行为 */
    readonly onClick: () => void;
    /**
     * 禁用态。函数形态在 observer 渲染期求值——读到宿主 MobX 状态时自动获得响应式;
     * 必须纯函数,禁止副作用。
     */
    readonly disabled?: boolean | (() => boolean);
}

/** 工具栏扩展按钮(值对象):布尔/函数双形态的禁用源收敛为 isDisabled() 单一口径 */
export class ToolbarExtension {
    /** 稳定标识(React key + 去重判据),已 trim */
    readonly key: string;
    readonly icon: ReactNode;
    /** 可见文案;null = 纯图标形态 */
    readonly label: string | null;
    /** 悬浮提示;label 存在时缺省回落 label。null = 无可见名且无悬浮提示 → 非法条目,过滤时被丢弃 */
    readonly tooltip: string | null;
    readonly onClick: () => void;
    private readonly disabledSource: boolean | (() => boolean) | undefined;

    constructor(init: ToolbarExtensionInit) {
        this.key = init.key.trim();
        this.icon = init.icon;
        this.label = normalizeOptionalText(init.label);
        this.tooltip = normalizeOptionalText(init.tooltip) ?? this.label;
        this.onClick = init.onClick;
        this.disabledSource = init.disabled;
    }

    /** 可访问名:label 优先,纯图标形态回落 tooltip(过滤保证非空) */
    get ariaLabel(): string {
        return this.label ?? this.tooltip ?? "";
    }

    /** 渲染期求值;函数形态在 observer 内读宿主 MobX 状态即获响应式 */
    isDisabled(): boolean {
        const source = this.disabledSource;
        return typeof source === "function" ? source() : source === true;
    }
}

/** 归一化后的采集动作文案:aria 已解出终值,label 保留 null 表达「纯图标」 */
interface CaptureActionPresentation {
    readonly label: string | null;
    readonly ariaLabel: string;
    readonly tooltip: string;
}

interface CaptureVideoPresentation {
    readonly label: string | null;
    readonly ariaLabel: string;
    readonly discardLabel: string;
    readonly stopLabel: string;
}

/** 壳层呈现定制入参:品牌名 + 采集按钮文案 + 工具栏扩展位 */
export interface DeskShellPresentationInit {
    /** 产品名(左上项目药丸);缺省 "3D 导演台" */
    readonly productName?: string;
    readonly captureImage?: CaptureActionPresentationInit;
    readonly captureVideo?: CaptureVideoPresentationInit;
    /** 动作区扩展位(截图/录制右侧) */
    readonly toolbarExtensions?: readonly ToolbarExtensionInit[];
    /** 最右扩展位(全屏预览右侧;宿主窗口控制类动作:缩小/关闭等,纯图标形态) */
    readonly trailingExtensions?: readonly ToolbarExtensionInit[];
}

/**
 * 壳层呈现配置(值对象):宿主对产品出口层的品牌化/语义定制。
 * 创建期注入、运行期不变——不进文档、不进撤销栈、不经命令层;
 * 命令词汇(capture.frame 等)保持通用语义,定制只发生在出口展示层。
 * 运行期唯一动态口:扩展按钮 disabled 的函数形态。
 */
export class DeskShellPresentation {
    readonly productName: string;
    readonly captureImage: CaptureActionPresentation;
    readonly captureVideo: CaptureVideoPresentation;
    readonly toolbarExtensions: readonly ToolbarExtension[];
    readonly trailingExtensions: readonly ToolbarExtension[];
    private readonly customVideoTooltip: string | null;

    constructor(init?: DeskShellPresentationInit) {
        const imageLabel = normalizeOptionalText(init?.captureImage?.label);
        const videoLabel = normalizeOptionalText(init?.captureVideo?.label);
        this.productName = normalizeOptionalText(init?.productName) ?? DEFAULT_TEXT.PRODUCT_NAME;
        this.captureImage = {
            label: imageLabel,
            ariaLabel: imageLabel ?? DEFAULT_TEXT.CAPTURE_IMAGE_TOOLTIP,
            tooltip: normalizeOptionalText(init?.captureImage?.tooltip) ?? DEFAULT_TEXT.CAPTURE_IMAGE_TOOLTIP,
        };
        this.captureVideo = {
            label: videoLabel,
            ariaLabel: videoLabel ?? DEFAULT_TEXT.CAPTURE_VIDEO_ARIA,
            discardLabel: normalizeOptionalText(init?.captureVideo?.discardLabel) ?? DEFAULT_TEXT.DISCARD_RECORDING,
            stopLabel: normalizeOptionalText(init?.captureVideo?.stopLabel) ?? DEFAULT_TEXT.STOP_RECORDING,
        };
        this.customVideoTooltip = normalizeOptionalText(init?.captureVideo?.tooltip);
        this.toolbarExtensions = normalizeExtensions(init?.toolbarExtensions);
        this.trailingExtensions = normalizeExtensions(init?.trailingExtensions);
    }

    /**
     * 录制按钮悬浮提示:宿主定制优先;缺省拼实际导出区间。
     * 导出范围已由播放范围(入出点)决定,提示必须跟着它走——写死 0~时长会在设了入出点后骗人。
     */
    captureVideoTooltip(range: { readonly inSeconds: number; readonly outSeconds: number }): string {
        return (
            this.customVideoTooltip ??
            `${DEFAULT_TEXT.RECORDING_TOOLTIP_PREFIX}${range.inSeconds}~${range.outSeconds}${DEFAULT_TEXT.RECORDING_TOOLTIP_SUFFIX}`
        );
    }
}

/** 空白视为未提供:trim 后为空串回落缺省 */
function normalizeOptionalText(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/** 滤掉空 key/label 与重复 key 的非法扩展;宿主配置错误降级为 dev 警告,不拖垮整桌 */
function normalizeExtensions(init: readonly ToolbarExtensionInit[] | undefined): readonly ToolbarExtension[] {
    const seen = new Set<string>();
    return (init ?? []).flatMap((raw) => {
        const extension = new ToolbarExtension(raw);
        const invalid = extension.key.length === 0 || extension.tooltip === null || seen.has(extension.key);
        if (invalid) {
            if (import.meta.env.DEV) {
                console.warn(
                    "[DeskShellPresentation] 忽略非法工具栏扩展(空 key、label/tooltip 全空或 key 重复):",
                    raw.key,
                );
            }
            return [];
        }
        seen.add(extension.key);
        return [extension];
    });
}
