import type { SerializedCommand } from "@/command/DirectorCommand";

export const TIMELINE_SELECTION_KIND = {
    NONE: "none",
    PROGRAM_CLIP: "program-clip",
    MOTION_CLIP: "motion-clip",
    MOTION_KEY: "motion-key",
    WALK_TRACK: "walk-track",
    WALK_KEY: "walk-key",
} as const;
export type TimelineSelectionKind = (typeof TIMELINE_SELECTION_KIND)[keyof typeof TIMELINE_SELECTION_KIND];

/**
 * 删除命令的 TYPE 在此以字面量常量表达,不引用命令类:
 * 依赖方向是「命令层 → 领域层」,领域值对象反向 import 命令类会成环。
 */
const REMOVE_COMMAND_TYPE = {
    PROGRAM_CLIP: "program.remove-clip",
    MOTION_CLIP: "motion.remove-clip",
    MOTION_KEY: "motion.remove-key",
    WALK_KEY: "timeline.remove-key",
} as const;

interface SelectionIdentity {
    /** 承载者 id:片段 id 或轨道 id */
    readonly ownerId: string | null;
    /** 成员 id:关键帧 id;整段/整轨选中时为 null */
    readonly memberId: string | null;
}

/**
 * 删除分派表:全键 Record,新增种类漏配即编译期报错。
 * walk-track 刻意返回 null——删整条走位轨的破坏力远大于一枚帧,
 * Delete 不该绑它;轨级删除留在检查器里的显式按钮。
 */
const DELETE_COMMAND: Record<TimelineSelectionKind, (identity: SelectionIdentity) => SerializedCommand | null> = {
    [TIMELINE_SELECTION_KIND.NONE]: () => null,
    [TIMELINE_SELECTION_KIND.PROGRAM_CLIP]: ({ ownerId }) => ({
        type: REMOVE_COMMAND_TYPE.PROGRAM_CLIP,
        payload: { id: ownerId },
    }),
    [TIMELINE_SELECTION_KIND.MOTION_CLIP]: ({ ownerId }) => ({
        type: REMOVE_COMMAND_TYPE.MOTION_CLIP,
        payload: { id: ownerId },
    }),
    [TIMELINE_SELECTION_KIND.MOTION_KEY]: ({ ownerId, memberId }) => ({
        type: REMOVE_COMMAND_TYPE.MOTION_KEY,
        payload: { clipId: ownerId, keyId: memberId },
    }),
    [TIMELINE_SELECTION_KIND.WALK_TRACK]: () => null,
    [TIMELINE_SELECTION_KIND.WALK_KEY]: ({ ownerId, memberId }) => ({
        type: REMOVE_COMMAND_TYPE.WALK_KEY,
        payload: { trackId: ownerId, keyframeId: memberId },
    }),
};

/** owner 归属于运镜片段的种类:片段高亮、检查器与预览据此取 clip */
const OWNER_IS_MOTION_CLIP: Record<TimelineSelectionKind, boolean> = {
    [TIMELINE_SELECTION_KIND.NONE]: false,
    [TIMELINE_SELECTION_KIND.PROGRAM_CLIP]: false,
    [TIMELINE_SELECTION_KIND.MOTION_CLIP]: true,
    [TIMELINE_SELECTION_KIND.MOTION_KEY]: true,
    [TIMELINE_SELECTION_KIND.WALK_TRACK]: false,
    [TIMELINE_SELECTION_KIND.WALK_KEY]: false,
};

/** owner 归属于走位轨的种类 */
const OWNER_IS_WALK_TRACK: Record<TimelineSelectionKind, boolean> = {
    [TIMELINE_SELECTION_KIND.NONE]: false,
    [TIMELINE_SELECTION_KIND.PROGRAM_CLIP]: false,
    [TIMELINE_SELECTION_KIND.MOTION_CLIP]: false,
    [TIMELINE_SELECTION_KIND.MOTION_KEY]: false,
    [TIMELINE_SELECTION_KIND.WALK_TRACK]: true,
    [TIMELINE_SELECTION_KIND.WALK_KEY]: true,
};

/**
 * 时间轴选中态(值对象,不可变,可 JSON 往返)。
 *
 * 存在的理由:选中一枚帧这件事此前有三份真相——时间轴面板的局部 state、
 * 3D 把手读的走位选中、检查器读的运镜选中——于是「底栏显示的帧」与「Delete 删掉的帧」
 * 可以指向不同对象,底栏还没有清除路径。本类把「时间轴上正被编辑的是谁」收敛成
 * 一个二元组(owner + member),删除命令与快捷键作用域都从它派生。
 */
export class TimelineSelection {
    /** 空选中是常量:每次清选都新建实例会让 observer 无谓失效 */
    private static readonly EMPTY = new TimelineSelection(TIMELINE_SELECTION_KIND.NONE, null, null);

    readonly kind: TimelineSelectionKind;
    readonly ownerId: string | null;
    readonly memberId: string | null;

    private constructor(kind: TimelineSelectionKind, ownerId: string | null, memberId: string | null) {
        this.kind = kind;
        this.ownerId = ownerId;
        this.memberId = memberId;
        Object.freeze(this);
    }

    static none(): TimelineSelection {
        return TimelineSelection.EMPTY;
    }

    static programClip(clipId: string): TimelineSelection {
        return new TimelineSelection(TIMELINE_SELECTION_KIND.PROGRAM_CLIP, clipId, null);
    }

    static motionClip(clipId: string): TimelineSelection {
        return new TimelineSelection(TIMELINE_SELECTION_KIND.MOTION_CLIP, clipId, null);
    }

    static motionKey(clipId: string, keyId: string): TimelineSelection {
        return new TimelineSelection(TIMELINE_SELECTION_KIND.MOTION_KEY, clipId, keyId);
    }

    static walkTrack(trackId: string): TimelineSelection {
        return new TimelineSelection(TIMELINE_SELECTION_KIND.WALK_TRACK, trackId, null);
    }

    static walkKey(trackId: string, keyframeId: string): TimelineSelection {
        return new TimelineSelection(TIMELINE_SELECTION_KIND.WALK_KEY, trackId, keyframeId);
    }

    get isEmpty(): boolean {
        return this.kind === TIMELINE_SELECTION_KIND.NONE;
    }

    /** 运镜片段 id:选中整段或段内一枚关键帧时都成立 */
    get motionClipId(): string | null {
        return OWNER_IS_MOTION_CLIP[this.kind] ? this.ownerId : null;
    }

    get motionKeyId(): string | null {
        return this.kind === TIMELINE_SELECTION_KIND.MOTION_KEY ? this.memberId : null;
    }

    get walkTrackId(): string | null {
        return OWNER_IS_WALK_TRACK[this.kind] ? this.ownerId : null;
    }

    get walkKeyframeId(): string | null {
        return this.kind === TIMELINE_SELECTION_KIND.WALK_KEY ? this.memberId : null;
    }

    get programClipId(): string | null {
        return this.kind === TIMELINE_SELECTION_KIND.PROGRAM_CLIP ? this.ownerId : null;
    }

    equals(other: TimelineSelection): boolean {
        return this.kind === other.kind && this.ownerId === other.ownerId && this.memberId === other.memberId;
    }

    /** 实体被删除后判断本选中是否已失效(owner 与 member 同域比较即可,id 全局唯一) */
    references(entityId: string): boolean {
        return this.ownerId === entityId || this.memberId === entityId;
    }

    /** Delete 的唯一落点:UI 按钮与快捷键共用,避免两条删除路径指向不同对象 */
    deleteCommand(): SerializedCommand | null {
        return DELETE_COMMAND[this.kind]({ ownerId: this.ownerId, memberId: this.memberId });
    }

    toJSON(): {
        readonly kind: TimelineSelectionKind;
        readonly ownerId: string | null;
        readonly memberId: string | null;
    } {
        return { kind: this.kind, ownerId: this.ownerId, memberId: this.memberId };
    }
}
