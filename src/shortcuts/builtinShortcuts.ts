import { FrameViewCommand } from "@/command/navigationCommands";
import { isCommandIssue } from "@/authoring/KeyframeAuthoringService";
import { RemoveShotCommand } from "@/command/cameraCommands";
import { RemoveMotionKeyCommand, SetViewModeCommand } from "@/command/cameraMotionCommands";
import { TransportSetLoopCommand } from "@/command/actionCommands";
import { EnterPresentationCommand, ExitPresentationCommand } from "@/command/presentationCommands";
import { requestFrameCapture } from "@/command/captureCommands";
import { VIEW_MODE } from "@/store/MotionAuthoringStore";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { ShortcutChord } from "@/shortcuts/ShortcutChord";
import type { ShortcutRegistry, ShortcutScope } from "@/shortcuts/ShortcutRegistry";

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
    MOTION_KEY_DELETE: "motion.key.delete",
    TRANSPORT_LOOP: "transport.loop",
    DRAFT_EXIT: "draft.exit",
    WALK_KEY_DELETE: "walk.key.delete",
    PALETTE_OPEN: "palette.open",
} as const;
export type ShortcutId = (typeof SHORTCUT_ID)[keyof typeof SHORTCUT_ID];

/**
 * 快捷键 SPECS(纯数据表,单一真相源):
 * - 行为在下方 ACTIONS,按 id 对齐(Record 全键约束,漏配编译期报错);
 * - UI 提示经 formatShortcutHint 从本表格式化,按钮提示与真实生效键永不分叉;
 * - 顺序即优先级(注册表先命中先执行):预览退出排在一切 Escape 之前。
 *
 * Space 不做播放/暂停:WASD+Space/Shift 的飞行导航已持续占用它(见 useFlyNavigation),
 * 双绑会让抬升相机的同时启停时间轴。播放启停走 P,与 DCC 的传输键位习惯一致。
 *
 * Escape 分层:presentation → lens → shot(退出掌镜) → gizmo(退出变换) → selected(取消选中),
 * 由本表行序裁决;Delete 分层:motion-key → selected(删除选中)。
 */
export const SHORTCUT_SPECS: readonly {
    id: ShortcutId;
    chords: readonly string[];
    scope: ShortcutScope;
    label: string;
}[] = [
    { id: SHORTCUT_ID.PRESENTATION_EXIT, chords: ["escape"], scope: "presentation", label: "退出全屏预览" },
    { id: SHORTCUT_ID.LENS_EXIT, chords: ["escape"], scope: "lens", label: "退出镜头视角" },
    { id: SHORTCUT_ID.DRAFT_EXIT, chords: ["escape"], scope: "draft", label: "退出绘制走位" },
    {
        id: SHORTCUT_ID.MOTION_KEY_DELETE,
        chords: ["delete", "backspace"],
        scope: "motion-key",
        label: "删除选中镜头关键帧",
    },
    {
        id: SHORTCUT_ID.WALK_KEY_DELETE,
        chords: ["delete", "backspace"],
        scope: "walk-key",
        label: "删除选中走位关键帧",
    },
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
    { id: SHORTCUT_ID.FRAME_ALL, chords: ["home"], scope: "global", label: "取景全部对象" },
    { id: SHORTCUT_ID.TRANSPORT_TOGGLE, chords: ["p"], scope: "global", label: "播放/暂停时间轴" },
    { id: SHORTCUT_ID.PRESENTATION_ENTER, chords: ["shift+p"], scope: "global", label: "全屏预览成片" },
    { id: SHORTCUT_ID.EDIT_UNDO, chords: ["mod+z"], scope: "global", label: "撤销" },
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

function removeSelectedMotionKey(stores: DirectorDeskStores): void {
    const { selectedClipId, selectedKeyId } = stores.motionAuthoring;
    if (!selectedClipId || !selectedKeyId) return;
    const result = stores.dispatcher.dispatch(
        { type: RemoveMotionKeyCommand.TYPE, payload: { clipId: selectedClipId, keyId: selectedKeyId } },
        stores,
    );
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

/** 删掉最后两枚之一会让轨迹退化,交由命令层与轨道容器裁决,快捷键不预判。 */
function removeSelectedWalkKey(stores: DirectorDeskStores): void {
    const { selectedWalkTrackId, selectedWalkKeyframeId } = stores.motionAuthoring;
    if (!selectedWalkTrackId || !selectedWalkKeyframeId) return;
    const result = stores.dispatcher.dispatch(
        { type: "timeline.remove-key", payload: { trackId: selectedWalkTrackId, keyframeId: selectedWalkKeyframeId } },
        stores,
    );
    if (!result.ok) {
        stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
        return;
    }
    stores.motionAuthoring.selectWalkKey(null, null);
}

function enterPresentation(stores: DirectorDeskStores): void {
    const result = stores.dispatcher.dispatch({ type: EnterPresentationCommand.TYPE, payload: {} }, stores);
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
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
    [SHORTCUT_ID.MOTION_KEY_DELETE]: removeSelectedMotionKey,
    [SHORTCUT_ID.WALK_KEY_DELETE]: removeSelectedWalkKey,
    [SHORTCUT_ID.DRAFT_EXIT]: (s) => s.motionAuthoring.setDraftActive(false),
    [SHORTCUT_ID.TRANSPORT_LOOP]: (s) =>
        s.dispatcher.dispatch({ type: TransportSetLoopCommand.TYPE, payload: { loop: !s.clock.isLooping } }, s),
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
 * 其余情形 global 常驻;selected/gizmo/shot-selected/shot/lens/motion-key 各自按精确条件激活
 * (gizmo = 变换已激活,即 ui.gizmoArmedId 命中主选),Esc 的归属由 SHORTCUT_SPECS 的顺序决定
 * (注册表先命中先执行)。
 */
export function activeShortcutScopes(stores: DirectorDeskStores): ReadonlySet<ShortcutScope> {
    if (stores.layout.presentationMode) return new Set<ShortcutScope>(["presentation"]);
    const primaryId = stores.selection.primaryId;
    const hasSelectedInactiveShot =
        primaryId !== null &&
        stores.camera.activeShotId === null &&
        stores.camera.director.getShot(primaryId) !== undefined;
    return new Set<ShortcutScope>([
        "global",
        ...(stores.motionAuthoring.selectedWalkKeyframeId !== null ? ["walk-key" as const] : []),
        ...(stores.motionAuthoring.draftActive ? ["draft" as const] : []),
        ...(stores.motionAuthoring.lensViewActive ? ["lens" as const] : []),
        ...(stores.motionAuthoring.selectedKeyId !== null ? ["motion-key" as const] : []),
        ...(primaryId ? ["selected" as const] : []),
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
