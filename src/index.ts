// 公共出口:宿主(Monet 插件壳)只从这里消费
import "@/styles/index.css";

export { ACTOR_SURFACE, ACTOR_SURFACE_LABEL_ZH, ACTOR_SURFACE_PARAMS, ActorAppearance } from "@/actor/ActorAppearance";
export type { ActorAppearanceInit, ActorSurface, ActorSurfaceParams } from "@/actor/ActorAppearance";
export { ACTOR_GIRTH_SCALE, ACTOR_HEIGHT_METERS, ACTOR_SHOULDER_SCALE, ActorBuild } from "@/actor/ActorBuild";
export type { ActorBuildInit, ActorBuildRange } from "@/actor/ActorBuild";
export { ActorProfile } from "@/actor/ActorProfile";
export type { ActorProfileInit } from "@/actor/ActorProfile";
export { ACTOR_PALETTE, paletteHexFor } from "@/actor/ActorPalette";
export type { ActorPaletteSwatch } from "@/actor/ActorPalette";
export { BUILD_PRESETS, compileBuildPreset, matchBuildPreset } from "@/actor/BuildPresetCompiler";
export type { BuildPreset } from "@/actor/BuildPresetCompiler";
export { BodyBuildSolver } from "@/actor/BodyBuildSolver";
export { BoneScalePlan } from "@/actor/BoneScalePlan";
export type { BoneScaleEntry } from "@/actor/BoneScalePlan";
export { ActorRuntime } from "@/actor/ActorRuntime";
export { BODY_PART, MIXAMO_PART_BONES, SKELETON_FAMILY_MIXAMO, isBodyPart } from "@/actor/mixamoSkeleton";
export type { BodyPart, BoneRotationsByName } from "@/actor/mixamoSkeleton";
export {
    ActorPresetsQuery,
    ApplyBuildPresetCommand,
    GetActorQuery,
    registerActorCommands,
    SetActorAppearanceCommand,
    SetActorBuildCommand,
} from "@/command/actorCommands";
export { PosePreset, parsePosePreset } from "@/pose/PosePreset";
export type { PosePresetJSON } from "@/pose/PosePreset";
export { AnimationBinder } from "@/animation/AnimationBinder";
export { BoneCompatibilityChecker, BONE_MATCH_THRESHOLD } from "@/animation/BoneCompatibilityChecker";
export type { BoneCheckResult } from "@/animation/BoneCompatibilityChecker";
export { AssetLibrary } from "@/assets/AssetLibrary";
export { AnimationLibrary } from "@/assets/AnimationLibrary";
export { ActionAsset } from "@/assets/ActionAsset";
export { formatFromFileName, formatFromUrl, ModelAsset, MODEL_FORMAT } from "@/assets/ModelAsset";
export type { ModelFormat } from "@/assets/ModelAsset";
export { HostBridge, HostBridgeConfiguration, HostBridgeSession } from "@/bridge/HostBridge";
export {
    HOST_BRIDGE_FAILURE_CODE,
    HOST_INBOUND_MESSAGE_TYPE,
    HOST_OUTBOUND_MESSAGE_TYPE,
    PROTOCOL_VERSION,
    isDirectorDeskMessage,
} from "@/bridge/protocol";
export type {
    HostBridgeFailureCode,
    HostInboundMessage,
    HostOutboundMessage,
    HostOutboundRequest,
} from "@/bridge/protocol";
export { CameraDirector } from "@/camera/CameraDirector";
export { CameraShot, DEFAULT_CAMERA_FOV, FOV_MAX, FOV_MIN, SHOT_SIZE } from "@/camera/CameraShot";
export type { CameraShotJSON, ShotSize } from "@/camera/CameraShot";
export { ShotSizePresets } from "@/camera/ShotSizePresets";
export { FramingService } from "@/camera/FramingService";
export {
    CameraFocusTrack,
    FOCUS_TARGET_KIND,
    SceneObjectFocusTarget,
    WorldPointFocusTarget,
} from "@/camera/CameraFocusTrack";
export type {
    CameraFocusTrackInit,
    CameraFocusTrackJSON,
    FocusTarget,
    FocusTargetJSON,
    FocusTargetKind,
    FocusTargetSample,
    SceneObjectFocusTargetJSON,
    WorldPointFocusTargetJSON,
} from "@/camera/CameraFocusTrack";
export { FocusTargetResolver } from "@/camera/FocusTargetResolver";
export { MotionKey, MOTION_HANDLE_MODE, MOTION_PROGRESS_MAX, MOTION_PROGRESS_MIN } from "@/motion/MotionKey";
export type { MotionHandleMode, MotionKeyInit, MotionKeyJSON, MotionKeyLike } from "@/motion/MotionKey";
export { AutoHandleSolver, createHandlePair } from "@/motion/AutoHandleSolver";
export type { MotionHandlePair } from "@/motion/AutoHandleSolver";
export { MotionTrajectory, createPositionSample } from "@/motion/MotionTrajectory";
export type { MotionPositionSample } from "@/motion/MotionTrajectory";
export { CameraKey, cameraKeyFrom } from "@/camera/CameraKey";
export type { CameraKeyInit, CameraKeyJSON, CameraKeyPose } from "@/camera/CameraKey";
export { CAMERA_MOTION_EASING, easedProgress, isCameraMotionEasing } from "@/camera/CameraMotionEasing";
export type { CameraMotionEasing } from "@/camera/CameraMotionEasing";
export { CameraMotionClip, createCameraMotionSample, sampleCameraMotionClip } from "@/camera/CameraMotionClip";
export type { CameraMotionClipInit, CameraMotionClipJSON, CameraMotionSample } from "@/camera/CameraMotionClip";
export { PROGRAM_SLOT_KIND, ProgramLinkage } from "@/camera/ProgramLinkage";
export type { ProgramSlot, ProgramSlotKind } from "@/camera/ProgramLinkage";
export { subjectBoundsFor } from "@/command/subjectBounds";
export type { SubjectBounds } from "@/command/subjectBounds";
export type { ViewportPoseSource } from "@/camera/ViewportPoseSource";
export { TimelineViewport } from "@/authoring/TimelineViewport";
export type { TimelineViewportInit } from "@/authoring/TimelineViewport";
export { TIMELINE_BAR_KIND, TIMELINE_MARK_KIND, TIMELINE_ROW_KIND, TimelineLayout } from "@/authoring/TimelineLayout";
export type { TimelineBar, TimelineMark, TimelineRow } from "@/authoring/TimelineLayout";
export { SNAP_THRESHOLD_PX, SnapResolver } from "@/authoring/SnapResolver";
export type { SnapCandidates, SnapRequest } from "@/authoring/SnapResolver";
export { KeyframeAuthoringService, isCommandIssue } from "@/authoring/KeyframeAuthoringService";
export {
    DEFAULT_PRESET_DURATION_SECONDS,
    isOrbitDirection,
    MOTION_MOVE,
    MOTION_MOVE_LABEL,
    MotionPresetCompiler,
    ORBIT_DIRECTION,
    ORBIT_MAX_DEGREES,
} from "@/authoring/MotionPresetCompiler";
export type {
    MotionMove,
    MotionPresetContext,
    MotionPresetRequest,
    OrbitDirection,
} from "@/authoring/MotionPresetCompiler";
export { MotionAuthoringStore, VIEW_MODE } from "@/store/MotionAuthoringStore";
export type { ViewMode } from "@/store/MotionAuthoringStore";
export { CameraProgramClip, CameraProgramTrack } from "@/camera/CameraProgramTrack";
export type {
    CameraProgramClipInit,
    CameraProgramClipJSON,
    CameraProgramTrackInit,
    CameraProgramTrackJSON,
} from "@/camera/CameraProgramTrack";
export { CameraMotionSampler } from "@/camera/CameraMotionSampler";
export type { CameraMotionSink } from "@/camera/CameraMotionSampler";
export type { DirectorPose } from "@/store/CameraStore";
export { CaptureService } from "@/capture/CaptureService";
export type { CaptureHelperLifecycle, RenderHandles } from "@/capture/CaptureService";
export {
    CaptureFrameCommand,
    CaptureVideoCommand,
    CancelVideoCaptureCommand,
    registerCaptureCommands,
} from "@/command/captureCommands";
export { ExportDocumentQuery, ImportDocumentCommand, registerDocumentCommands } from "@/command/documentCommands";
export { assembleDeskDocument, DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
export { DocumentImportService } from "@/document/DocumentImportService";
export { AssetCatalog } from "@/assets/catalog/AssetCatalog";
export { BuiltinAssetProvider } from "@/assets/catalog/AssetProvider";
export type { AssetProvider } from "@/assets/catalog/AssetProvider";
export { ASSET_CATEGORY, ASSET_KIND, ASSET_SOURCE } from "@/assets/catalog/AssetEntry";
export type { AssetEntry, AssetKind, AssetSource } from "@/assets/catalog/AssetEntry";
export {
    AssetsListQuery,
    AssetsMountCommand,
    AssetsPlaceCommand,
    registerAssetCatalogCommands,
} from "@/command/assetCatalogCommands";
export type { DeskDocument, DeskDocumentAction, DeskDocumentMotion } from "@/document/DeskDocument";
export { FrameViewCommand, registerNavigationCommands } from "@/command/navigationCommands";
export {
    AdjustLightCommand,
    LightingGetQuery,
    LightingListQuery,
    registerLightingCommands,
} from "@/command/lightingCommands";
export type { LightingObjectSnapshot } from "@/command/lightingCommands";
export {
    AuthorMotionCommand,
    CameraMotionGetQuery,
    CreateMotionClipCommand,
    CreateMotionTakeCommand,
    EnterMotionPreviewCommand,
    ExitMotionPreviewCommand,
    MoveMotionKeyCommand,
    PROGRAM_FOLLOW,
    QuickAuthorMotionCommand,
    RemoveMotionClipCommand,
    RemoveMotionKeyCommand,
    RemoveProgramClipCommand,
    ResetMotionKeyHandlesCommand,
    registerCameraMotionCommands,
    SetMotionClipFocusCommand,
    SetMotionClipRangeCommand,
    SetMotionKeyCommand,
    SetMotionClipEasingCommand,
    SetMotionKeyHandleCommand,
    SetProgramClipCommand,
    SetViewModeCommand,
} from "@/command/cameraMotionCommands";
export type { ProgramFollow } from "@/command/cameraMotionCommands";
export { CommandHistory } from "@/command/CommandHistory";
export type { HistoryEntry } from "@/command/CommandHistory";
export { CommandDispatcher } from "@/command/CommandDispatcher";
export {
    MoveObjectCommand,
    PlaceObjectCommand,
    registerBuiltinCommands,
    RemoveObjectCommand,
    SetCameraShotCommand,
} from "@/command/commands";
export {
    AddTimelineKeyCommand,
    MoveTimelineKeyCommand,
    RemoveTimelineKeyCommand,
    RestoreTimelineTracksCommand,
    SetTimelineDurationCommand,
    SetTimelineKeyEasingCommand,
    registerTimelineCommands,
} from "@/command/timelineCommands";
export { DirectorCommand } from "@/command/DirectorCommand";
export {
    ActivateShotCommand,
    DeactivateShotCommand,
    registerCameraCommands,
    RemoveShotCommand,
    CameraFrameSubjectCommand,
    CameraListShotsQuery,
} from "@/command/cameraCommands";
export {
    MountActionCommand,
    registerActionCommands,
    TransportPauseCommand,
    TransportPlayCommand,
    TransportSeekCommand,
    UnmountActionCommand,
    TransportStopCommand,
    TransportGetStateQuery,
} from "@/command/actionCommands";
export type {
    CommandIssue,
    CommandIssueOption,
    CommandResult,
    DirectorContext,
    SerializedCommand,
} from "@/command/DirectorCommand";
export type { CommandCapability, DirectorQuery, QueryResult } from "@/command/CommandDispatcher";
export type { DispatchOptions } from "@/command/CommandDispatcher";
export { EMPTY_PAYLOAD_CONTRACT, nullable, TRANSFORM_SCHEMA, VEC3_SCHEMA } from "@/command/PayloadContract";
export type { ContractViolation, PayloadContract, PayloadFieldSchema } from "@/command/PayloadContract";
export {
    PLACEMENT_RELATION,
    PlaceRelativeCommand,
    PlacementCompiler,
    registerPlacementCommands,
} from "@/command/placementCommands";
export type { PlacementRelation } from "@/command/placementCommands";
export {
    ApplyPosePresetCommand,
    ClearPoseCommand,
    DiscoverPoseBonesQuery,
    GetPoseQuery,
    ReplacePoseCommand,
    SetPoseBoneCommand,
    registerPoseCommands,
} from "@/command/poseCommands";
export { DisposeBag } from "@/core/DisposeBag";
export { SceneManager } from "@/core/SceneManager";
export { IDENTITY_TRANSFORM, SceneObject } from "@/core/SceneObject";
export type { SceneObjectInit, SceneObjectKind, Transform, Vec3 } from "@/core/SceneObject";
export {
    createDefaultLightParams,
    isLightColor,
    isLightIntensity,
    isLightType,
    LIGHT_INTENSITY_MAX,
    LIGHT_INTENSITY_MIN,
    LIGHT_TYPES,
    normalizeLightParams,
} from "@/core/LightParams";
export type { LightParams, LightType } from "@/core/LightParams";
export { PoseSnapshot } from "@/pose/PoseSnapshot";
export type { BoneKey, PoseSnapshotInit, QuaternionTuple } from "@/pose/PoseSnapshot";
export { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
export type { BoneTreeNodeDto, SemanticBoneCandidateDto, SkeletonDiscoveryDto } from "@/pose/SkeletonRuntimeRegistry";
export { PostMessageAdapter } from "@/host/HostAdapter";
export type { HostAdapter } from "@/host/HostAdapter";
export { ModelImporter } from "@/loaders/ModelImporter";
export type { ModelHandle } from "@/loaders/ModelImporter";
export { CameraStore } from "@/store/CameraStore";
export { CameraMotionStore } from "@/store/CameraMotionStore";
export { SceneStore } from "@/store/SceneStore";
export { SelectionStore } from "@/store/SelectionStore";
export { GIZMO_MODE, UiStore } from "@/store/UiStore";
export type { CaptureMeta, VideoMeta } from "@/store/UiStore";
export { TimelineStore } from "@/store/TimelineStore";
export { RENDER_QUALITY, RENDER_QUALITY_PROFILES, WorkbenchLayoutStore } from "@/store/WorkbenchLayoutStore";
export type { RenderQuality } from "@/store/WorkbenchLayoutStore";
export { WORKSPACE_SECTION, WORKSPACE_SECTION_DEFS, WORKSPACE_SECTION_ORDER } from "@/workspace/workspaceSections";
export type { WorkspaceSection, WorkspaceSectionDef } from "@/workspace/workspaceSections";
export { EnterPresentationCommand, ExitPresentationCommand } from "@/command/presentationCommands";
export type { GizmoMode } from "@/store/UiStore";
export { ShortcutChord } from "@/shortcuts/ShortcutChord";
export { ShortcutRegistry } from "@/shortcuts/ShortcutRegistry";
export type { ShortcutBinding, ShortcutScope } from "@/shortcuts/ShortcutRegistry";
export {
    activeShortcutScopes,
    formatShortcutHint,
    registerBuiltinShortcuts,
    SHORTCUT_ID,
    SHORTCUT_SPECS,
} from "@/shortcuts/builtinShortcuts";
export type { ShortcutId } from "@/shortcuts/builtinShortcuts";
export type { GizmoAxis } from "@/store/UiStore";
export { TimeTransport } from "@/time/TimeTransport";
export { TimelineDoc, DEFAULT_TIMELINE_DURATION_SECONDS } from "@/timeline/TimelineDoc";
export type { TimelineDocInit } from "@/timeline/TimelineDoc";
export { TimelineTrack, TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
export { registerKeyframeCodec, keyframeCodecFor } from "@/timeline/keyframeCodecs";
export type { KeyframeCodec } from "@/timeline/keyframeCodecs";
export type { TimelineTrackInit, TimelineTrackKind } from "@/timeline/TimelineTrack";
export { TransformKeyframe, TIMELINE_EASING } from "@/timeline/TransformKeyframe";
export type { TimelineEasing, TransformKeyframeInit } from "@/timeline/TransformKeyframe";
export { TimelineSampler, evaluateTimelineTransform, evaluateTransformTrack } from "@/timeline/TimelineSampler";
export type { TransformSample } from "@/timeline/TimelineSampler";
export { PlaybackCoordinator } from "@/timeline/PlaybackCoordinator";
export type { TimelineInvalidator } from "@/timeline/PlaybackCoordinator";
export { createDirectorDeskStores, DirectorDeskProvider, useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
export type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
export { DirectorDesk } from "@/ui/shell/DirectorDesk";
export type { DirectorDeskProps } from "@/ui/shell/DirectorDesk";
export { DeskShellPresentation, ToolbarExtension } from "@/ui/shell/DeskShellPresentation";
export type {
    CaptureActionPresentationInit,
    CaptureVideoPresentationInit,
    DeskShellPresentationInit,
    ToolbarExtensionInit,
} from "@/ui/shell/DeskShellPresentation";
export { TimelinePanel } from "@/ui/timeline/TimelinePanel";
