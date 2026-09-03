import { FrameViewCommand } from "@/command/navigationCommands";
import { isCommandIssue } from "@/authoring/KeyframeAuthoringService";
import { RemoveShotCommand } from "@/command/cameraCommands";
import { SetViewModeCommand } from "@/command/cameraMotionCommands";
import { TransportSetLoopCommand } from "@/command/actionCommands";
import {
    EnterPresentationCommand,
    ExitPresentationCommand,
    SetShellHiddenCommand,
} from "@/command/presentationCommands";
import { requestFrameCapture } from "@/command/captureCommands";
import { VIEW_MODE } from "@/store/MotionAuthoringStore";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { ShortcutChord } from "@/shortcuts/ShortcutChord";
import type { ShortcutRegistry, ShortcutScope } from "@/shortcuts/ShortcutRegistry";
import { SetTimelinePlaybackRangeCommand } from "@/command/timelineCommands";
import { TransportSeekCommand } from "@/command/actionCommands";
import { TimelineViewport } from "@/authoring/TimelineViewport";

/** 播放头「跳一秒」的步长:与逐帧步进(读工程帧率)分工,粗定位不必按帧数 */
const PLAYHEAD_JUMP_SECONDS = 1;
const TIMELINE_START_SECONDS = 0;
/** 键盘缩放与滚轮缩放同一手感:一次一档,不做加速度 */
const TIMELINE_ZOOM_IN_FACTOR = 0.8;
const TIMELINE_ZOOM_OUT_FACTOR = 1.25;
const RATIO_MIN = 0;
const RATIO_MAX = 1;
/** 锚点跳转的死区:播放头正落在锚点上时不该原地不动,也不该被浮点噪声误判 */
const ANCHOR_EPSILON_SECONDS = 0.0005;

const ANCHOR_DIRECTION = { PREV: "prev", NEXT: "next" } as const;
const RANGE_BOUNDARY = { IN: "in", OUT: "out" } as const;
type RangeBoundary = (typeof RANGE_BOUNDARY)[keyof typeof RANGE_BOUNDARY];

/** 快捷键动作 id:AI 工具描述/文档/冲突检测的引用键 */
export const SHORTCUT_ID = {
    AXIS_X: "gizmo.axis.x",
    AXIS_Y: "gizmo.axis.y",
    AXIS_Z: "gizmo.axis.z",
    GIZMO_TOGGLE: "gizmo.toggle",
    GIZMO_EXIT: "gizmo.exit",
    REMOVE_SELECTION: "selection.remove",
    CLEAR_SELECTION: "selection.clear",
    SHOT_ENTER: "shot.enter",
    SHOT_EXIT: "shot.exit",
    SHOT_PHOTO: "shot.photo",
    FRAME_SELECTED: "view.frame-selected",
    FRAME_ALL: "view.frame-all",
    EDIT_UNDO: "edit.undo",
    EDIT_REDO: "edit.redo",
    HELP_TOGGLE: "help.toggle",
    TRANSPORT_TOGGLE: "transport.toggle",
    TIMELINE_ADD_KEY: "timeline.add-key",
    PRESENTATION_ENTER: "presentation.enter",
    PRESENTATION_EXIT: "presentation.exit",
    LENS_TOGGLE: "lens.toggle",
    LENS_EXIT: "lens.exit",
    TIMELINE_SELECTION_DELETE: "timeline.selection.delete",
    TIMELINE_SELECTION_CLEAR: "timeline.selection.clear",
    TRANSPORT_LOOP: "transport.loop",
    DRAFT_EXIT: "draft.exit",
    PALETTE_OPEN: "palette.open",
    SHELL_TOGGLE: "shell.toggle",
    PLAYHEAD_STEP_BACK: "playhead.step-back",
    PLAYHEAD_STEP_FORWARD: "playhead.step-forward",
    PLAYHEAD_JUMP_BACK: "playhead.jump-back",
    PLAYHEAD_JUMP_FORWARD: "playhead.jump-forward",
    PLAYHEAD_START: "playhead.start",
    PLAYHEAD_END: "playhead.end",
    ANCHOR_PREV: "playhead.anchor-prev",
    ANCHOR_NEXT: "playhead.anchor-next",
    RANGE_SET_IN: "range.set-in",
    RANGE_SET_OUT: "range.set-out",
    TIMELINE_ZOOM_FIT: "timeline.zoom-fit",
    TIMELINE_ZOOM_IN: "timeline.zoom-in",
    TIMELINE_ZOOM_OUT: "timeline.zoom-out",
    SNAP_TOGGLE: "timeline.snap-toggle",
    TIMELINE_EXPAND_TOGGLE: "timeline.expand-toggle",
} as const;
export type ShortcutId = (typeof SHORTCUT_ID)[keyof typeof SHORTCUT_ID];

/**
 * 快捷键 SPECS(纯数据表,单一真相源):
 * - 行为在下方 ACTIONS,按 id 对齐(Record 全键约束,漏配编译期报错);
 * - UI 提示经 formatShortcutHint 从本表格式化,按钮提示与真实生效键永不分叉;
 * - 顺序即优先级(注册表先命中先执行):预览退出排在一切 Escape 之前。
 *
 * **Space / S 的归属由指针裁决,不靠优先级**:飞行导航(WASD+Space/Shift)与时间轴键位共用物理键,
 * timeline 作用域仅在指针停在时间线控制台内时激活,同时 useFlyNavigation 在该条件下整体让位——
 * 同一时刻只有一方接管,不存在两边同时响应的窗口。P 仍是全局播放键,指针在哪儿都管用。
 *
 * 时间轴上被聚焦的段条/菱形自己消费方向键与 Enter/Space,并在处理后 stopPropagation,
 * 因此不会与 timeline 作用域的播放头键位重复触发。
 *
 * Escape 分层:presentation → lens → draft → 时间轴选中 → gizmo(退出变换) → selected(取消选中),
 * 由本表行序裁决;Delete 分层:时间轴选中 → selected(删除选中)。
 */
export const SHORTCUT_SPECS: readonly {
    id: ShortcutId;
    chords: readonly string[];
    scope: ShortcutScope;
    label: string;
}[] = [
    { id: SHORTCUT_ID.PRESENTATION_EXIT, chords: ["escape"], scope: "presentation", label: "退出全屏预览" },
    { id: SHORTCUT_ID.SHELL_TOGGLE, chords: ["tab"], scope: "presentation", label: "隐藏/恢复悬浮壳层" },
    { id: SHORTCUT_ID.LENS_EXIT, chords: ["escape"], scope: "lens", label: "退出镜头视角" },
    { id: SHORTCUT_ID.DRAFT_EXIT, chords: ["escape"], scope: "draft", label: "退出绘制走位" },
    {
        id: SHORTCUT_ID.TIMELINE_SELECTION_CLEAR,
        chords: ["escape"],
        scope: "timeline-selection",
        label: "取消时间轴选中",
    },
    {
        id: SHORTCUT_ID.TIMELINE_SELECTION_DELETE,
        chords: ["delete", "backspace"],
        scope: "timeline-selection",
        label: "删除时间轴选中项",
    },
    // timeline 作用域:仅在指针停在时间线控制台内时激活(见 activeShortcutScopes)
    { id: SHORTCUT_ID.TRANSPORT_TOGGLE, chords: ["space"], scope: "timeline", label: "播放/暂停时间轴" },
    { id: SHORTCUT_ID.PLAYHEAD_STEP_BACK, chords: ["arrowleft"], scope: "timeline", label: "播放头后退一帧" },
    { id: SHORTCUT_ID.PLAYHEAD_STEP_FORWARD, chords: ["arrowright"], scope: "timeline", label: "播放头前进一帧" },
    { id: SHORTCUT_ID.PLAYHEAD_JUMP_BACK, chords: ["shift+arrowleft"], scope: "timeline", label: "播放头后退一秒" },
    {
        id: SHORTCUT_ID.PLAYHEAD_JUMP_FORWARD,
        chords: ["shift+arrowright"],
        scope: "timeline",
        label: "播放头前进一秒",
    },
    { id: SHORTCUT_ID.ANCHOR_PREV, chords: [","], scope: "timeline", label: "跳到上一个时间锚点" },
    { id: SHORTCUT_ID.ANCHOR_NEXT, chords: ["."], scope: "timeline", label: "跳到下一个时间锚点" },
    { id: SHORTCUT_ID.RANGE_SET_IN, chords: ["i"], scope: "timeline", label: "在播放头设入点" },
    { id: SHORTCUT_ID.RANGE_SET_OUT, chords: ["o"], scope: "timeline", label: "在播放头设出点" },
    { id: SHORTCUT_ID.TIMELINE_ZOOM_FIT, chords: ["shift+z"], scope: "timeline", label: "缩放到全长" },
    { id: SHORTCUT_ID.TIMELINE_ZOOM_IN, chords: ["="], scope: "timeline", label: "以播放头为锚放大" },
    { id: SHORTCUT_ID.TIMELINE_ZOOM_OUT, chords: ["-"], scope: "timeline", label: "以播放头为锚缩小" },
    { id: SHORTCUT_ID.SNAP_TOGGLE, chords: ["s"], scope: "timeline", label: "吸附开关" },
    { id: SHORTCUT_ID.AXIS_X, chords: ["x"], scope: "gizmo", label: "约束/切换 X 轴" },
    { id: SHORTCUT_ID.AXIS_Y, chords: ["y"], scope: "gizmo", label: "约束/切换 Y 轴" },
    { id: SHORTCUT_ID.AXIS_Z, chords: ["z"], scope: "gizmo", label: "约束/切换 Z 轴" },
    { id: SHORTCUT_ID.GIZMO_TOGGLE, chords: ["g"], scope: "selected", label: "进入/退出变换" },
    { id: SHORTCUT_ID.REMOVE_SELECTION, chords: ["delete", "backspace"], scope: "selected", label: "删除选中" },
    { id: SHORTCUT_ID.TIMELINE_ADD_KEY, chords: ["k"], scope: "selected", label: "在当前时间打关键帧" },
    { id: SHORTCUT_ID.TIMELINE_ADD_KEY, chords: ["k"], scope: "lens", label: "在当前时刻落镜头关键帧" },
    { id: SHORTCUT_ID.SHOT_ENTER, chords: ["enter"], scope: "shot-selected", label: "进入掌镜" },
    { id: SHORTCUT_ID.SHOT_EXIT, chords: ["escape"], scope: "shot", label: "退出掌镜" },
    { id: SHORTCUT_ID.SHOT_PHOTO, chords: ["enter"], scope: "shot", label: "拍照" },
    { id: SHORTCUT_ID.GIZMO_EXIT, chords: ["escape"], scope: "gizmo", label: "退出变换" },
    { id: SHORTCUT_ID.CLEAR_SELECTION, chords: ["escape"], scope: "selected", label: "取消选中" },
    { id: SHORTCUT_ID.FRAME_SELECTED, chords: ["f"], scope: "selected", label: "聚焦选中对象" },
    { id: SHORTCUT_ID.PALETTE_OPEN, chords: ["mod+k"], scope: "global", label: "视角与元素导航" },
    { id: SHORTCUT_ID.PLAYHEAD_START, chords: ["home"], scope: "global", label: "播放头回到起点" },
    { id: SHORTCUT_ID.PLAYHEAD_END, chords: ["end"], scope: "global", label: "播放头到终点" },
    { id: SHORTCUT_ID.TIMELINE_EXPAND_TOGGLE, chords: ["t"], scope: "global", label: "展开/收起时间线" },
    { id: SHORTCUT_ID.FRAME_ALL, chords: ["shift+f"], scope: "global", label: "取景全部对象" },
    { id: SHORTCUT_ID.TRANSPORT_TOGGLE, chords: ["p"], scope: "global", label: "播放/暂停时间轴" },
    { id: SHORTCUT_ID.PRESENTATION_ENTER, chords: ["shift+p"], scope: "global", label: "全屏预览成片" },
    { id: SHORTCUT_ID.SHELL_TOGGLE, chords: ["tab"], scope: "global", label: "隐藏/恢复悬浮壳层" },
    { id: SHORTCUT_ID.EDIT_REDO, chords: ["mod+shift+z"], scope: "global", label: "重做" },
    { id: SHORTCUT_ID.HELP_TOGGLE, chords: ["shift+/"], scope: "global", label: "快捷键速查" },
    { id: SHORTCUT_ID.LENS_TOGGLE, chords: ["`"], scope: "global", label: "导演视角 ↔ 镜头视角" },
    { id: SHORTCUT_ID.TRANSPORT_LOOP, chords: ["l"], scope: "global", label: "循环播放开关" },
];

function removeSelection(stores: DirectorDeskStores): void {
    // 机位不是场景实体,住在 CameraDirector 里;按 id 归属分派,否则 Delete 对机位是空操作
    for (const id of stores.selection.selectedIds) {
        const isShot = stores.camera.director.getShot(id) !== undefined;
        const result = stores.dispatcher.dispatch(
            { type: isShot ? RemoveShotCommand.TYPE : "object.remove", payload: { id } },
            stores,
        );
        if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    }
    stores.selection.clear();
}

function activateSelectedShot(stores: DirectorDeskStores): void {
    const shotId = stores.selection.primaryId;
    if (!shotId || stores.camera.director.getShot(shotId) === undefined) return;
    stores.dispatcher.dispatch({ type: "camera.activate", payload: { id: shotId } }, stores);
}

/** G 进出变换:机位不挂 gizmo(TransformGizmoController 的领域排除),此处同步拦下,不留空挂状态 */
function toggleGizmoArm(stores: DirectorDeskStores): void {
    const id = stores.selection.primaryId;
    if (!id || stores.camera.director.getShot(id) !== undefined) return;
    if (stores.ui.isGizmoArmed(id)) stores.ui.disarmGizmo();
    else stores.ui.armGizmo(id);
}

/** K 的上下文分派收敛在 KeyframeAuthoringService:此处只负责把结构化 issue 落成提示。 */
function keyCurrentContext(stores: DirectorDeskStores): void {
    const resolved = stores.keyframeAuthoring.resolve(stores);
    if (isCommandIssue(resolved)) {
        stores.ui.setApplicationNotice(resolved.message);
        return;
    }
    const result = stores.dispatcher.dispatch(resolved, stores);
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

function toggleLensView(stores: DirectorDeskStores): void {
    const mode = stores.motionAuthoring.lensViewActive ? VIEW_MODE.DIRECTOR : VIEW_MODE.LENS;
    stores.dispatcher.dispatch({ type: SetViewModeCommand.TYPE, payload: { mode } }, stores);
}

/**
 * 时间轴选中项的删除:命令由 TimelineSelection 分派,与底栏删除按钮同一条路径。
 * 删哪一枚、能不能删(如运镜至少两枚关键帧)由命令层裁决,快捷键不预判。
 */
function removeTimelineSelection(stores: DirectorDeskStores): void {
    const command = stores.timelineSelection.current.deleteCommand();
    if (!command) return;
    const result = stores.dispatcher.dispatch(command, stores);
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

function enterPresentation(stores: DirectorDeskStores): void {
    const result = stores.dispatcher.dispatch({ type: EnterPresentationCommand.TYPE, payload: {} }, stores);
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

function toggleShellChrome(stores: DirectorDeskStores): void {
    stores.dispatcher.dispatch(
        { type: SetShellHiddenCommand.TYPE, payload: { hidden: !stores.layout.isShellHidden } },
        stores,
    );
}

/** 播放头位移的唯一出口:落点交给 transport.seek 的命令层量化与钳位,快捷键不自己算边界。 */
function seekBy(stores: DirectorDeskStores, deltaSeconds: number): void {
    stores.dispatcher.dispatch(
        { type: TransportSeekCommand.TYPE, payload: { time: stores.clock.time + deltaSeconds } },
        stores,
    );
}

/**
 * 时间锚点集合:片段两端 + 全部关键帧 + 标记。
 * 直接取 TimelineLayout 的全长投影——它已经是「时间轴上有意义的时刻」的单一真相,
 * 快捷键再拼一份必然与吸附候选漂移。
 */
function anchorTimes(stores: DirectorDeskStores): readonly number[] {
    const durationSeconds = stores.timeline.document.duration;
    const rows = stores.timelineLayout.project(TimelineViewport.full(durationSeconds));
    const times = rows.flatMap((row) => [
        ...row.bars.flatMap((bar) => [bar.startSeconds, bar.startSeconds + bar.durationSeconds]),
        ...row.marks.map((mark) => mark.timeSeconds),
    ]);
    return [...new Set(times)].sort((left, right) => left - right);
}

function seekToAnchor(
    stores: DirectorDeskStores,
    direction: typeof ANCHOR_DIRECTION.PREV | typeof ANCHOR_DIRECTION.NEXT,
): void {
    const current = stores.clock.time;
    const anchors = anchorTimes(stores);
    const target =
        direction === ANCHOR_DIRECTION.NEXT
            ? anchors.find((time) => time > current + ANCHOR_EPSILON_SECONDS)
            : [...anchors].reverse().find((time) => time < current - ANCHOR_EPSILON_SECONDS);
    if (target === undefined) return;
    stores.dispatcher.dispatch({ type: TransportSeekCommand.TYPE, payload: { time: target } }, stores);
}

/** 入出点:以当前播放头改写一端,另一端原样带上——命令层负责 out > in 的合法性裁决。 */
function setRangeBoundary(stores: DirectorDeskStores, boundary: RangeBoundary): void {
    const range = stores.timeline.document.playbackRange;
    const payload =
        boundary === RANGE_BOUNDARY.IN
            ? { inSeconds: stores.clock.time, outSeconds: range.outSeconds }
            : { inSeconds: range.inSeconds, outSeconds: stores.clock.time };
    const result = stores.dispatcher.dispatch({ type: SetTimelinePlaybackRangeCommand.TYPE, payload }, stores);
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

/** 以播放头为锚缩放:与滚轮缩放共用 TimelineViewport 的锚点语义,只是锚点换成播放头。 */
function zoomTimeline(stores: DirectorDeskStores, factor: number): void {
    const durationSeconds = stores.timeline.document.duration;
    const viewport = stores.motionAuthoring.timelineViewportFor(durationSeconds);
    const anchorRatio = Math.min(Math.max(viewport.ratioAt(stores.clock.time), RATIO_MIN), RATIO_MAX);
    stores.motionAuthoring.setTimelineViewport(viewport.zoomedAt(factor, anchorRatio, durationSeconds));
}

const SHORTCUT_ACTIONS: Record<ShortcutId, (stores: DirectorDeskStores) => void> = {
    [SHORTCUT_ID.AXIS_X]: (s) => s.ui.toggleGizmoAxis("x"),
    [SHORTCUT_ID.AXIS_Y]: (s) => s.ui.toggleGizmoAxis("y"),
    [SHORTCUT_ID.AXIS_Z]: (s) => s.ui.toggleGizmoAxis("z"),
    [SHORTCUT_ID.GIZMO_TOGGLE]: toggleGizmoArm,
    [SHORTCUT_ID.GIZMO_EXIT]: (s) => s.ui.disarmGizmo(),
    [SHORTCUT_ID.PALETTE_OPEN]: (s) => s.ui.setPaletteOpen(true),
    [SHORTCUT_ID.REMOVE_SELECTION]: removeSelection,
    [SHORTCUT_ID.TIMELINE_ADD_KEY]: keyCurrentContext,
    [SHORTCUT_ID.SHOT_ENTER]: activateSelectedShot,
    [SHORTCUT_ID.SHOT_EXIT]: (s) => s.dispatcher.dispatch({ type: "camera.deactivate", payload: {} }, s),
    [SHORTCUT_ID.SHOT_PHOTO]: (s) => requestFrameCapture({ dispatcher: s.dispatcher, context: s }),
    [SHORTCUT_ID.CLEAR_SELECTION]: (s) => s.selection.clear(),
    [SHORTCUT_ID.FRAME_SELECTED]: (s) =>
        s.dispatcher.dispatch({ type: FrameViewCommand.TYPE, payload: { ids: [...s.selection.selectedIds] } }, s),
    [SHORTCUT_ID.FRAME_ALL]: (s) => s.dispatcher.dispatch({ type: FrameViewCommand.TYPE, payload: {} }, s),
    [SHORTCUT_ID.TRANSPORT_TOGGLE]: (s) =>
        s.dispatcher.dispatch({ type: s.clock.isPlaying ? "transport.pause" : "transport.play", payload: {} }, s),
    [SHORTCUT_ID.PRESENTATION_ENTER]: enterPresentation,
    [SHORTCUT_ID.PRESENTATION_EXIT]: (s) =>
        s.dispatcher.dispatch({ type: ExitPresentationCommand.TYPE, payload: {} }, s),
    [SHORTCUT_ID.EDIT_UNDO]: (s) => s.history.undo(s),
    [SHORTCUT_ID.EDIT_REDO]: (s) => s.history.redo(s),
    [SHORTCUT_ID.HELP_TOGGLE]: (s) => s.ui.toggleHelp(),
    [SHORTCUT_ID.LENS_TOGGLE]: toggleLensView,
    [SHORTCUT_ID.LENS_EXIT]: (s) =>
        s.dispatcher.dispatch({ type: SetViewModeCommand.TYPE, payload: { mode: VIEW_MODE.DIRECTOR } }, s),
    [SHORTCUT_ID.TIMELINE_SELECTION_DELETE]: removeTimelineSelection,
    [SHORTCUT_ID.TIMELINE_SELECTION_CLEAR]: (s) => s.timelineSelection.clear(),
    [SHORTCUT_ID.DRAFT_EXIT]: (s) => s.motionAuthoring.setDraftActive(false),
    [SHORTCUT_ID.TRANSPORT_LOOP]: (s) =>
        s.dispatcher.dispatch({ type: TransportSetLoopCommand.TYPE, payload: { loop: !s.clock.isLooping } }, s),
    [SHORTCUT_ID.SHELL_TOGGLE]: toggleShellChrome,
    [SHORTCUT_ID.PLAYHEAD_STEP_BACK]: (s) => seekBy(s, -s.timeline.document.frameRate.frameDurationSeconds),
    [SHORTCUT_ID.PLAYHEAD_STEP_FORWARD]: (s) => seekBy(s, s.timeline.document.frameRate.frameDurationSeconds),
    [SHORTCUT_ID.PLAYHEAD_JUMP_BACK]: (s) => seekBy(s, -PLAYHEAD_JUMP_SECONDS),
    [SHORTCUT_ID.PLAYHEAD_JUMP_FORWARD]: (s) => seekBy(s, PLAYHEAD_JUMP_SECONDS),
    [SHORTCUT_ID.PLAYHEAD_START]: (s) =>
        s.dispatcher.dispatch({ type: TransportSeekCommand.TYPE, payload: { time: TIMELINE_START_SECONDS } }, s),
    [SHORTCUT_ID.PLAYHEAD_END]: (s) =>
        s.dispatcher.dispatch({ type: TransportSeekCommand.TYPE, payload: { time: s.timeline.document.duration } }, s),
    [SHORTCUT_ID.ANCHOR_PREV]: (s) => seekToAnchor(s, ANCHOR_DIRECTION.PREV),
    [SHORTCUT_ID.ANCHOR_NEXT]: (s) => seekToAnchor(s, ANCHOR_DIRECTION.NEXT),
    [SHORTCUT_ID.RANGE_SET_IN]: (s) => setRangeBoundary(s, RANGE_BOUNDARY.IN),
    [SHORTCUT_ID.RANGE_SET_OUT]: (s) => setRangeBoundary(s, RANGE_BOUNDARY.OUT),
    [SHORTCUT_ID.TIMELINE_ZOOM_FIT]: (s) =>
        s.motionAuthoring.setTimelineViewport(TimelineViewport.full(s.timeline.document.duration)),
    [SHORTCUT_ID.TIMELINE_ZOOM_IN]: (s) => zoomTimeline(s, TIMELINE_ZOOM_IN_FACTOR),
    [SHORTCUT_ID.TIMELINE_ZOOM_OUT]: (s) => zoomTimeline(s, TIMELINE_ZOOM_OUT_FACTOR),
    [SHORTCUT_ID.SNAP_TOGGLE]: (s) => s.motionAuthoring.setSnapEnabled(!s.motionAuthoring.snapEnabled),
    [SHORTCUT_ID.TIMELINE_EXPAND_TOGGLE]: (s) => s.layout.toggleTimelineExpanded(),
};

/** 内置快捷键注册:Hotkeys 挂载时调一次,返回整体注销 */
export function registerBuiltinShortcuts(registry: ShortcutRegistry<DirectorDeskStores>): () => void {
    const unregisters = SHORTCUT_SPECS.flatMap((spec) =>
        spec.chords.map((chord) =>
            registry.register({
                id: spec.id,
                chord: ShortcutChord.parse(chord),
                scope: spec.scope,
                run: SHORTCUT_ACTIONS[spec.id],
            }),
        ),
    );
    return () => {
        for (const unregister of unregisters) unregister();
    };
}

/**
 * 当前激活作用域。
 * 全屏预览独占:壳层已隐、成片正在放,此时一切编辑键位都不该生效——只留退出键。
 * 其余情形 global 常驻;timeline/timeline-selection/selected/gizmo/shot-selected/shot/lens 各自按精确条件激活:
 * - timeline = 指针停在时间线控制台内。它是键盘归属的仲裁面:同一时刻视口飞行导航整体让位(见 useFlyNavigation),
 *   因此 Space/S 这类共用键永远只有一方响应,不靠优先级碰运气;
 * - timeline-selection = 时间轴上选中了片段/关键帧/标记;
 * - gizmo = 变换已激活(ui.gizmoArmedId 命中主选)。
 * Esc 与 Delete 的归属由 SHORTCUT_SPECS 的顺序决定(注册表先命中先执行)。
 */
export function activeShortcutScopes(stores: DirectorDeskStores): ReadonlySet<ShortcutScope> {
    if (stores.layout.isProgramTakeover) return new Set<ShortcutScope>(["presentation"]);
    const primaryId = stores.selection.primaryId;
    const hasSelectedInactiveShot =
        primaryId !== null &&
        stores.camera.activeShotId === null &&
        stores.camera.director.getShot(primaryId) !== undefined;
    return new Set<ShortcutScope>([
        "global",
        ...(stores.timelineSelection.hasSelection ? ["timeline-selection" as const] : []),
        ...(stores.motionAuthoring.draftActive ? ["draft" as const] : []),
        ...(stores.motionAuthoring.lensViewActive ? ["lens" as const] : []),
        ...(primaryId ? ["selected" as const] : []),
        ...(stores.layout.isTimelinePointerOver ? ["timeline" as const] : []),
        ...(stores.ui.isGizmoArmed(primaryId) ? ["gizmo" as const] : []),
        ...(hasSelectedInactiveShot ? ["shot-selected" as const] : []),
        ...(stores.camera.activeShotId ? ["shot" as const] : []),
    ]);
}
/** UI 提示:同 id 多 chord 用 / 连接;平台格式化后同形的去重(Mac 上 Delete 与 Backspace 都是 ⌫) */
export function formatShortcutHint(id: ShortcutId): string {
    const spec = SHORTCUT_SPECS.find((s) => s.id === id);
    if (!spec) return "";
    const formatted = spec.chords.map((chord) => ShortcutChord.parse(chord).format());
    return [...new Set(formatted)].join("/");
}
