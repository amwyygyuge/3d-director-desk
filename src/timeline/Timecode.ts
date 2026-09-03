import type { FrameRate } from "@/timeline/FrameRate";

const TIMECODE_PART_WIDTH = 2;
const TIMECODE_ZERO = "0";
const SECONDS_PER_MINUTE = 60;
const TIMECODE_SEPARATOR = ":";
const TIMECODE_PART_COUNT = 3;
const MINUTES_INDEX = 0;
const SECONDS_INDEX = 1;
const FRAMES_INDEX = 2;
const DECIMAL_RADIX = 10;

function pad(value: number): string {
    return String(value).padStart(TIMECODE_PART_WIDTH, TIMECODE_ZERO);
}

/**
 * 时间码(mm:ss:ff)的唯一格式化与解析口。
 *
 * 此前时间码函数私藏在 TimelineConsole 里,帧率是写死的 30——面板与工程各说各话。
 * 帧位由 FrameRate 决定,格式化与解析必须共用同一个帧率,否则读数与落点会漂。
 */
export const Timecode = {
    format(seconds: number, frameRate: FrameRate): string {
        const totalFrames = Math.max(frameRate.toFrames(seconds), 0);
        const totalSeconds = Math.floor(totalFrames / frameRate.fps);
        const frames = totalFrames - totalSeconds * frameRate.fps;
        const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
        const secondsPart = totalSeconds - minutes * SECONDS_PER_MINUTE;
        return [minutes, secondsPart, frames].map(pad).join(TIMECODE_SEPARATOR);
    },

    /** 解析失败返回 null:调用方据此保留原值,不允许把 NaN 写进文档 */
    parse(text: string, frameRate: FrameRate): number | null {
        const parts = text.trim().split(TIMECODE_SEPARATOR);
        if (parts.length !== TIMECODE_PART_COUNT) return null;
        const numbers = parts.map((part) => Number.parseInt(part, DECIMAL_RADIX));
        if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null;
        const frames =
            (numbers[MINUTES_INDEX]! * SECONDS_PER_MINUTE + numbers[SECONDS_INDEX]!) * frameRate.fps +
            numbers[FRAMES_INDEX]!;
        return frameRate.fromFrames(frames);
    },
};
