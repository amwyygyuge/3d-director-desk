/** 统计采样的固定边长(像素):画面度量与画布分辨率解耦,读回开销恒定。 */
export const FRAME_STATISTICS_SAMPLE_SIZE = 64;
/** 高光/暗部的判定阈值(0~1 亮度)。超出即视为细节被裁掉。 */
const HIGHLIGHT_CLIP_THRESHOLD = 0.98;
const SHADOW_CLIP_THRESHOLD = 0.02;
/** 主体区:画幅中心的相对边长。构图惯例把主体放在中央偏上,取 0.5 覆盖常见景别。 */
const SUBJECT_REGION_FRACTION = 0.5;
/** Rec.709 亮度权重:与人眼敏感度一致,不能用 RGB 均值代替。 */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
const BYTES_PER_PIXEL = 4;

/**
 * 画面曝光与影调度量(纯数据,可 JSON 往返)。
 *
 * 存在意义:让「画面好不好」像几何一样可断言。此前曝光是否合理、主体是否从背景里跳出来,
 * 只能截图交给多模态判断——慢、贵、不稳定。这些标量让 AI 在不截图的前提下自查并重试,
 * 与 `camera.check-framing` 的 `marginNdc` 是同一类可执行证据。
 */
export interface FrameStatistics {
    /** 全画面平均亮度 0~1 */
    readonly meanLuma: number;
    /** 亮度标准差 0~1:影调层次,过低即"灰平一片" */
    readonly contrast: number;
    /** 高光被裁掉的像素占比 0~1 */
    readonly clippedHighlights: number;
    /** 暗部被压死的像素占比 0~1 */
    readonly clippedShadows: number;
    /** 画幅中心主体区的平均亮度 0~1 */
    readonly subjectLuma: number;
    /** 主体区之外(背景)的平均亮度 0~1 */
    readonly backgroundLuma: number;
    /**
     * 主体与背景的亮度分离度(带符号,`subjectLuma - backgroundLuma`)。
     *
     * 保留符号:正值是主体比背景亮(常规打亮),负值是剪影/逆光——两者都是有效的电影语言,
     * 取绝对值会让 AI 分不清"拍成剪影"与"主体被打亮",从而无法按意图校正。
     */
    readonly subjectSeparation: number;
}

/**
 * 画面度量分析器(领域服务,纯函数式计算,零 I/O)。
 *
 * 只接受已降采样的 RGBA 字节序列,不认识 WebGL、canvas 或 DOM——
 * 像素怎么来的是 `CaptureService` 的事,本类只负责把像素变成可断言的标量。
 * 因此它可被任何像素来源复用(视口、离屏、未来的成片帧),也不需要渲染上下文即可推理。
 */
export class FrameStatisticsAnalyzer {
    /**
     * @param pixels 长度为 `size * size * 4` 的 RGBA 字节序列(行优先)
     * @param size   采样方阵边长
     */
    analyze(pixels: Uint8Array | Uint8ClampedArray, size: number): FrameStatistics | null {
        const expected = size * size * BYTES_PER_PIXEL;
        if (size <= 0 || pixels.length < expected) return null;

        const subjectMargin = Math.floor((size * (1 - SUBJECT_REGION_FRACTION)) / 2);
        const subjectMin = subjectMargin;
        const subjectMax = size - subjectMargin;

        let sum = 0;
        let sumSquares = 0;
        let clippedHigh = 0;
        let clippedLow = 0;
        let subjectSum = 0;
        let subjectCount = 0;
        let backgroundSum = 0;
        let backgroundCount = 0;

        for (let y = 0; y < size; y += 1) {
            const isSubjectRow = y >= subjectMin && y < subjectMax;
            for (let x = 0; x < size; x += 1) {
                const index = (y * size + x) * BYTES_PER_PIXEL;
                // 归一化在此处一次完成:后续全部以 0~1 计算,避免 0~255 与 0~1 两套量纲混用
                const luma =
                    (LUMA_R * (pixels[index] ?? 0) +
                        LUMA_G * (pixels[index + 1] ?? 0) +
                        LUMA_B * (pixels[index + 2] ?? 0)) /
                    255;
                sum += luma;
                sumSquares += luma * luma;
                if (luma >= HIGHLIGHT_CLIP_THRESHOLD) clippedHigh += 1;
                if (luma <= SHADOW_CLIP_THRESHOLD) clippedLow += 1;
                if (isSubjectRow && x >= subjectMin && x < subjectMax) {
                    subjectSum += luma;
                    subjectCount += 1;
                } else {
                    backgroundSum += luma;
                    backgroundCount += 1;
                }
            }
        }

        const total = size * size;
        const meanLuma = sum / total;
        // 方差可能因浮点误差落到 -0,先夹到 0 再开方
        const variance = Math.max(0, sumSquares / total - meanLuma * meanLuma);
        const subjectLuma = subjectCount > 0 ? subjectSum / subjectCount : 0;
        const backgroundLuma = backgroundCount > 0 ? backgroundSum / backgroundCount : 0;
        return {
            meanLuma,
            contrast: Math.sqrt(variance),
            clippedHighlights: clippedHigh / total,
            clippedShadows: clippedLow / total,
            subjectLuma,
            backgroundLuma,
            subjectSeparation: subjectLuma - backgroundLuma,
        };
    }
}
