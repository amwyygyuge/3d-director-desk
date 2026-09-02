import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import { CameraProgramClip, PROGRAM_SOURCE_KIND, sameProgramSource } from "@/camera/CameraProgramTrack";
import type { CameraProgramTrack, ProgramSource } from "@/camera/CameraProgramTrack";

/** Program 时段的占用判定结果 */
export const PROGRAM_SLOT_KIND = {
    /** 空闲:直接生成同范围输出片段 */
    FREE: "free",
    /** 同一来源占用:扩展现有输出片段范围 */
    EXTEND: "extend",
    /** 其它来源占用:必须由作者/AI 二选一,禁止静默覆盖 */
    CONFLICT: "conflict",
} as const;
export type ProgramSlotKind = (typeof PROGRAM_SLOT_KIND)[keyof typeof PROGRAM_SLOT_KIND];

export interface ProgramSlot {
    readonly kind: ProgramSlotKind;
    readonly clips: readonly CameraProgramClip[];
}

const TIME_EPSILON = 1e-6;

function overlaps(clip: CameraProgramClip, startSeconds: number, endSeconds: number): boolean {
    return clip.startTimeSeconds < endSeconds && startSeconds < clip.endTimeSeconds;
}

function sameRange(clip: CameraProgramClip, startSeconds: number, durationSeconds: number): boolean {
    return (
        Math.abs(clip.startTimeSeconds - startSeconds) < TIME_EPSILON &&
        Math.abs(clip.durationSeconds - durationSeconds) < TIME_EPSILON
    );
}

function resolveSlotKind(foreignCount: number, occupiedCount: number): ProgramSlotKind {
    if (foreignCount > 0) return PROGRAM_SLOT_KIND.CONFLICT;
    return occupiedCount > 0 ? PROGRAM_SLOT_KIND.EXTEND : PROGRAM_SLOT_KIND.FREE;
}

/**
 * 运镜片段与 Program 输出片段的联动策略(领域服务,无状态)。
 *
 * 它回答两个问题:新建运镜时输出轨该怎么长出来(slotFor),以及重定时运镜时
 * 哪条输出片段属于「跟随态」应当一并重定时(followingClip)。两处调用方共用同一判据。
 */
export class ProgramLinkage {
    slotFor(program: CameraProgramTrack, source: ProgramSource, startSeconds: number, durationSeconds: number): ProgramSlot {
        const endSeconds = startSeconds + durationSeconds;
        const occupied = program.clips.filter((clip) => overlaps(clip, startSeconds, endSeconds));
        const foreign = occupied.filter((clip) => !sameProgramSource(clip.source, source));
        const kind = resolveSlotKind(foreign.length, occupied.length);
        return { kind, clips: foreign.length > 0 ? foreign : occupied };
    }

    /** 同来源占用时的合并范围:输出片段吞掉新片段,保持「同一时刻唯一输出」不变量。 */
    mergedClip(
        slot: ProgramSlot,
        source: ProgramSource,
        startSeconds: number,
        durationSeconds: number,
        fallbackId: string,
    ): CameraProgramClip {
        const endSeconds = startSeconds + durationSeconds;
        const starts = [startSeconds, ...slot.clips.map((clip) => clip.startTimeSeconds)];
        const ends = [endSeconds, ...slot.clips.map((clip) => clip.endTimeSeconds)];
        const mergedStart = Math.min(...starts);
        const mergedEnd = Math.max(...ends);
        return new CameraProgramClip({
            id: slot.clips[0]?.id ?? fallbackId,
            source,
            startTimeSeconds: mergedStart,
            durationSeconds: mergedEnd - mergedStart,
        });
    }

    /** 跟随态判定:输出片段直接引用该运镜且范围完全一致,重定时时一并移动。 */
    followingClip(program: CameraProgramTrack, motionClip: CameraMotionClip): CameraProgramClip | null {
        return (
            program.clips.find(
                (clip) =>
                    clip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP &&
                    clip.source.motionClipId === motionClip.id &&
                    sameRange(clip, motionClip.startTimeSeconds, motionClip.durationSeconds),
            ) ?? null
        );
    }
}
