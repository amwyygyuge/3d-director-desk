// 公共出口:宿主(Monet 插件壳)只从这里消费
import "./styles/index.css";

export { AnimationBinder } from "./animation/AnimationBinder";
export { BoneCompatibilityChecker, BONE_MATCH_THRESHOLD } from "./animation/BoneCompatibilityChecker";
export type { BoneCheckResult } from "./animation/BoneCompatibilityChecker";
export { AssetLibrary } from "./assets/AssetLibrary";
export { AnimationLibrary } from "./assets/AnimationLibrary";
export { ActionAsset } from "./assets/ActionAsset";
export { formatFromFileName, formatFromUrl, ModelAsset, MODEL_FORMAT } from "./assets/ModelAsset";
export type { ModelFormat } from "./assets/ModelAsset";
export { HostBridge } from "./bridge/HostBridge";
export { isDirectorDeskMessage } from "./bridge/protocol";
export type { HostInboundMessage, HostOutboundMessage } from "./bridge/protocol";
export { CameraDirector } from "./camera/CameraDirector";
export { CameraShot, SHOT_SIZE } from "./camera/CameraShot";
export type { ShotSize } from "./camera/CameraShot";
export { ShotSizePresets } from "./camera/ShotSizePresets";
export { FramingService } from "./camera/FramingService";
export type { DirectorPose } from "./store/CameraStore";
export { CaptureService } from "./capture/CaptureService";
export type { RenderHandles } from "./capture/CaptureService";
export { CaptureFrameCommand, registerCaptureCommands } from "./command/captureCommands";
export { FrameViewCommand, registerNavigationCommands } from "./command/navigationCommands";
export { CommandHistory } from "./command/CommandHistory";
export type { HistoryEntry } from "./command/CommandHistory";
export { CommandDispatcher } from "./command/CommandDispatcher";
export {
    MoveObjectCommand,
    PlaceObjectCommand,
    registerBuiltinCommands,
    RemoveObjectCommand,
    SetCameraShotCommand,
} from "./command/commands";
export { DirectorCommand } from "./command/DirectorCommand";
export {
    ActivateShotCommand,
    DeactivateShotCommand,
    registerCameraCommands,
    RemoveShotCommand,
} from "./command/cameraCommands";
export {
    MountActionCommand,
    registerActionCommands,
    TransportPauseCommand,
    TransportPlayCommand,
    TransportSeekCommand,
    UnmountActionCommand,
} from "./command/actionCommands";
export type { CommandResult, DirectorContext, SerializedCommand } from "./command/DirectorCommand";
export { DisposeBag } from "./core/DisposeBag";
export { SceneManager } from "./core/SceneManager";
export { IDENTITY_TRANSFORM, SceneObject } from "./core/SceneObject";
export type { SceneObjectKind, Transform, Vec3 } from "./core/SceneObject";
export { PostMessageAdapter } from "./host/HostAdapter";
export type { HostAdapter } from "./host/HostAdapter";
export { ModelImporter } from "./loaders/ModelImporter";
export type { ModelHandle } from "./loaders/ModelImporter";
export { CameraStore } from "./store/CameraStore";
export { SceneStore } from "./store/SceneStore";
export { SelectionStore } from "./store/SelectionStore";
export { GIZMO_MODE, UiStore } from "./store/UiStore";
export type { GizmoMode } from "./store/UiStore";
export { ShortcutChord } from "./shortcuts/ShortcutChord";
export { ShortcutRegistry } from "./shortcuts/ShortcutRegistry";
export type { ShortcutBinding, ShortcutScope } from "./shortcuts/ShortcutRegistry";
export {
    activeShortcutScopes,
    formatShortcutHint,
    registerBuiltinShortcuts,
    SHORTCUT_ID,
    SHORTCUT_SPECS,
} from "./shortcuts/builtinShortcuts";
export type { ShortcutId } from "./shortcuts/builtinShortcuts";
export type { GizmoAxis } from "./store/UiStore";
export { TimeTransport } from "./time/TimeTransport";
export { createDirectorDeskStores, DirectorDeskProvider, useDirectorDeskStores } from "./ui/DirectorDeskContext";
export type { DirectorDeskStores } from "./ui/DirectorDeskContext";
export { DirectorDesk } from "./ui/DirectorDesk";
