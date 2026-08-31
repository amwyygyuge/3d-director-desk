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
export { HostBridge, HostBridgeConfiguration, HostBridgeSession } from "./bridge/HostBridge";
export {
    HOST_BRIDGE_FAILURE_CODE,
    HOST_INBOUND_MESSAGE_TYPE,
    HOST_OUTBOUND_MESSAGE_TYPE,
    PROTOCOL_VERSION,
    isDirectorDeskMessage,
} from "./bridge/protocol";
export type {
    HostBridgeFailureCode,
    HostInboundMessage,
    HostOutboundMessage,
    HostOutboundRequest,
} from "./bridge/protocol";
export { CameraDirector } from "./camera/CameraDirector";
export { CameraShot, SHOT_SIZE } from "./camera/CameraShot";
export type { ShotSize } from "./camera/CameraShot";
export { ShotSizePresets } from "./camera/ShotSizePresets";
export { FramingService } from "./camera/FramingService";
export { CameraFocusTrack, FOCUS_TARGET_KIND, SceneObjectFocusTarget, WorldPointFocusTarget } from "./camera/CameraFocusTrack";
export type {
    CameraFocusTrackInit,
    CameraFocusTrackJSON,
    FocusTarget,
    FocusTargetJSON,
    FocusTargetKind,
    FocusTargetSample,
    SceneObjectFocusTargetJSON,
    WorldPointFocusTargetJSON,
} from "./camera/CameraFocusTrack";
export { FocusTargetResolver } from "./camera/FocusTargetResolver";
export { CameraMotionPath, MotionPathAnchor, sampleCameraMotionPath } from "./camera/CameraMotionPath";
export type {
    CameraMotionPathInit,
    CameraMotionPathJSON,
    MotionPathAnchorInit,
    MotionPathAnchorJSON,
    PathPositionSample,
} from "./camera/CameraMotionPath";
export { CAMERA_MOTION_EASING, CameraMotionClip, sampleCameraMotionClip } from "./camera/CameraMotionClip";
export type { CameraMotionClipInit, CameraMotionClipJSON, CameraMotionEasing, CameraMotionSample } from "./camera/CameraMotionClip";
export { CameraProgramClip, CameraProgramTrack } from "./camera/CameraProgramTrack";
export type {
    CameraProgramClipInit,
    CameraProgramClipJSON,
    CameraProgramTrackInit,
    CameraProgramTrackJSON,
} from "./camera/CameraProgramTrack";
export { CameraMotionSampler } from "./camera/CameraMotionSampler";
export type { CameraMotionSink } from "./camera/CameraMotionSampler";
export type { DirectorPose } from "./store/CameraStore";
export { CaptureService } from "./capture/CaptureService";
export type { CaptureHelperLifecycle, RenderHandles } from "./capture/CaptureService";
export {
    CaptureFrameCommand,
    CaptureVideoCommand,
    CancelVideoCaptureCommand,
    registerCaptureCommands,
} from "./command/captureCommands";
export { ExportDocumentQuery, ImportDocumentCommand, registerDocumentCommands } from "./command/documentCommands";
export { assembleDeskDocument, DESK_DOCUMENT_VERSION } from "./document/DeskDocument";
export { AssetCatalog } from "./assets/catalog/AssetCatalog";
export { BuiltinAssetProvider } from "./assets/catalog/AssetProvider";
export type { AssetProvider } from "./assets/catalog/AssetProvider";
export { ASSET_CATEGORY, ASSET_KIND, ASSET_SOURCE } from "./assets/catalog/AssetEntry";
export type { AssetEntry, AssetKind, AssetSource } from "./assets/catalog/AssetEntry";
export {
    AssetsListQuery,
    AssetsMountCommand,
    AssetsPlaceCommand,
    registerAssetCatalogCommands,
} from "./command/assetCatalogCommands";
export type { DeskDocument, DeskDocumentAction, DeskDocumentMotion } from "./document/DeskDocument";
export { FrameViewCommand, registerNavigationCommands } from "./command/navigationCommands";
export {
    AdjustLightCommand,
    LightingGetQuery,
    LightingListQuery,
    registerLightingCommands,
} from "./command/lightingCommands";
export type { LightingObjectSnapshot } from "./command/lightingCommands";
export {
    CameraMotionGetQuery,
    CreateMotionClipCommand,
    RemoveMotionClipCommand,
    RemoveProgramClipCommand,
    registerCameraMotionCommands,
    SetMotionClipEasingCommand,
    SetMotionClipPathCommand,
    SetMotionClipRangeCommand,
    SetMotionClipFocusCommand,
    SetProgramClipCommand,
} from "./command/cameraMotionCommands";
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
export {
    AddTimelineKeyCommand,
    MoveTimelineKeyCommand,
    RemoveTimelineKeyCommand,
    RestoreTimelineTracksCommand,
    SetTimelineDurationCommand,
    SetTimelineKeyEasingCommand,
    registerTimelineCommands,
} from "./command/timelineCommands";
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
    TransportStopCommand,
} from "./command/actionCommands";
export type {
    CommandIssue,
    CommandIssueOption,
    CommandResult,
    DirectorContext,
    SerializedCommand,
} from "./command/DirectorCommand";
export type { CommandCapability, DirectorQuery, QueryResult } from "./command/CommandDispatcher";
export {
    ApplyPosePresetCommand,
    ClearPoseCommand,
    DiscoverPoseBonesQuery,
    GetPoseQuery,
    ReplacePoseCommand,
    SetPoseBoneCommand,
    registerPoseCommands,
} from "./command/poseCommands";
export { DisposeBag } from "./core/DisposeBag";
export { SceneManager } from "./core/SceneManager";
export { IDENTITY_TRANSFORM, SceneObject } from "./core/SceneObject";
export type { SceneObjectInit, SceneObjectKind, Transform, Vec3 } from "./core/SceneObject";
export {
    createDefaultLightParams,
    isLightColor,
    isLightIntensity,
    isLightType,
    LIGHT_INTENSITY_MAX,
    LIGHT_INTENSITY_MIN,
    LIGHT_TYPES,
    normalizeLightParams,
} from "./core/LightParams";
export type { LightParams, LightType } from "./core/LightParams";
export { PoseSnapshot } from "./pose/PoseSnapshot";
export type { BoneKey, PoseSnapshotInit, QuaternionTuple } from "./pose/PoseSnapshot";
export { SkeletonRuntimeRegistry } from "./pose/SkeletonRuntimeRegistry";
export type { BoneTreeNodeDto, SemanticBoneCandidateDto, SkeletonDiscoveryDto } from "./pose/SkeletonRuntimeRegistry";
export { PostMessageAdapter } from "./host/HostAdapter";
export type { HostAdapter } from "./host/HostAdapter";
export { ModelImporter } from "./loaders/ModelImporter";
export type { ModelHandle } from "./loaders/ModelImporter";
export { CameraStore } from "./store/CameraStore";
export { CameraMotionStore } from "./store/CameraMotionStore";
export { SceneStore } from "./store/SceneStore";
export { SelectionStore } from "./store/SelectionStore";
export { GIZMO_MODE, UiStore } from "./store/UiStore";
export { TimelineStore } from "./store/TimelineStore";
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
export { TimelineDoc, DEFAULT_TIMELINE_DURATION_SECONDS } from "./timeline/TimelineDoc";
export type { TimelineDocInit } from "./timeline/TimelineDoc";
export { TimelineTrack, TIMELINE_TRACK_KIND } from "./timeline/TimelineTrack";
export { registerKeyframeCodec, keyframeCodecFor } from "./timeline/keyframeCodecs";
export type { KeyframeCodec } from "./timeline/keyframeCodecs";
export type { TimelineTrackInit, TimelineTrackKind } from "./timeline/TimelineTrack";
export { TransformKeyframe, TIMELINE_EASING } from "./timeline/TransformKeyframe";
export type { TimelineEasing, TransformKeyframeInit } from "./timeline/TransformKeyframe";
export { TimelineSampler, evaluateTimelineTransform, evaluateTransformTrack } from "./timeline/TimelineSampler";
export type { TransformSample } from "./timeline/TimelineSampler";
export { PlaybackCoordinator } from "./timeline/PlaybackCoordinator";
export type { TimelineInvalidator } from "./timeline/PlaybackCoordinator";
export { createDirectorDeskStores, DirectorDeskProvider, useDirectorDeskStores } from "./ui/DirectorDeskContext";
export type { DirectorDeskStores } from "./ui/DirectorDeskContext";
export { DirectorDesk } from "./ui/DirectorDesk";
export type { DirectorDeskProps } from "./ui/DirectorDesk";
export { TimelinePanel } from "./ui/TimelinePanel";
