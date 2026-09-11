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
export { ACTION_LOOP_MODE, ActionAsset } from "@/assets/ActionAsset";
export type { ActionLoopMode } from "@/assets/ActionAsset";
export { ActionPerformance, MINIMUM_ACTION_DURATION_SECONDS } from "@/animation/ActionPerformance";
export type { ActionPerformanceInit } from "@/animation/ActionPerformance";
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
export {
    CameraFollowTrack,
    FOLLOW_APPROACH,
    FOLLOW_APPROACH_AZIMUTH,
    isFollowApproach,
    FOLLOW_ANCHOR_LIMIT_METERS,
    FOLLOW_LAG_MAX_SECONDS,
    FOLLOW_LAG_MIN_SECONDS,
    FOLLOW_SMOOTHING_MAX_SECONDS,
    FOLLOW_SMOOTHING_MIN_SECONDS,
} from "@/camera/CameraFollowTrack";
export type { CameraFollowTrackJSON, FollowApproach } from "@/camera/CameraFollowTrack";
export { FOLLOW_SPACE, FollowSpaceCodec, followSpaceCodecFor } from "@/camera/FollowSpaceCodec";
export type { FollowSpace } from "@/camera/FollowSpaceCodec";
export { CameraFrameSolver } from "@/camera/CameraFrameSolver";
export { FOLLOW_FRAME, isFollowFrame, SubjectFrameResolver } from "@/motion/SubjectFrameResolver";
export type { FollowFrame, SubjectFrameRequest, TimelineDocumentSource } from "@/motion/SubjectFrameResolver";
export { SubjectFrameSample } from "@/motion/SubjectFrameSample";
export { MotionKey, MOTION_HANDLE_MODE, MOTION_PROGRESS_MAX, MOTION_PROGRESS_MIN } from "@/motion/MotionKey";
export type { MotionHandleMode, MotionKeyInit, MotionKeyJSON, MotionKeyLike } from "@/motion/MotionKey";
export { AutoHandleSolver, createHandlePair } from "@/motion/AutoHandleSolver";
export type { MotionHandlePair } from "@/motion/AutoHandleSolver";
export { MotionTrajectory, createPositionSample } from "@/motion/MotionTrajectory";
export type { MotionPositionSample } from "@/motion/MotionTrajectory";
export { CameraKey, cameraKeyFrom } from "@/camera/CameraKey";
export type { CameraKeyInit, CameraKeyJSON, CameraKeyPose } from "@/camera/CameraKey";
export { EASING, EASING_LABEL, easedProgress, inverseEasedProgress, isEasingCurve } from "@/motion/EasingCurve";
export type { EasingCurve } from "@/motion/EasingCurve";
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
export { TIMELINE_SELECTION_KIND, TimelineSelection } from "@/authoring/TimelineSelection";
export type { TimelineSelectionKind } from "@/authoring/TimelineSelection";
export { DEFAULT_FRAME_RATE_FPS, FRAME_RATE_FPS, FrameRate, isFrameRateFps } from "@/timeline/FrameRate";
export { Timecode } from "@/timeline/Timecode";
export { PlaybackRange } from "@/timeline/PlaybackRange";
export type { PlaybackRangeInit } from "@/timeline/PlaybackRange";
export { TimelineMarker } from "@/timeline/TimelineMarker";
export type { TimelineMarkerInit, TimelineMarkerJSON } from "@/timeline/TimelineMarker";
export { TIMELINE_CONTENT_BLOCKER_KIND, TimelineContentSpan } from "@/authoring/TimelineContentSpan";
export type { TimelineContentBlocker, TimelineContentBlockerKind } from "@/authoring/TimelineContentSpan";
export { TIMELINE_DRAG_KIND, TimelineClipDragResolver } from "@/authoring/TimelineClipDrag";
export type {
    TimelineClipDragResolveOptions,
    TimelineClipDragTransformOptions,
    TimelineClipRange,
    TimelineDragKind,
} from "@/authoring/TimelineClipDrag";
export { SNAP_THRESHOLD_PX, SnapResolver } from "@/authoring/SnapResolver";
export type { SnapCandidates, SnapRequest } from "@/authoring/SnapResolver";
export { KeyframeAuthoringService, isCommandIssue } from "@/authoring/KeyframeAuthoringService";
export { PathSimplifier } from "@/authoring/PathSimplifier";
export { DEFAULT_WALK_SPEED_MPS, WalkDraftCompiler } from "@/authoring/WalkDraftCompiler";
export type { WalkDraftInput } from "@/authoring/WalkDraftCompiler";
export {
    DEFAULT_PRESET_DURATION_SECONDS,
    isOrbitDirection,
    isOrbitMove,
    MOTION_DURATION_OPTIONS_SECONDS,
    MOTION_MOVE,
    MOTION_MOVE_LABEL,
    MOTION_PROGRAM_RANGE_DECIMALS,
    motionProgramRangeFor,
    MotionPresetCompiler,
    ORBIT_DEFAULT_DEGREES,
    ORBIT_DEGREES_OPTIONS,
    ORBIT_DIRECTION,
    ORBIT_MAX_DEGREES,
    ORBIT_RADIUS_MAX_METERS,
    ORBIT_RADIUS_MIN_METERS,
    OrbitMotionParameters,
} from "@/authoring/MotionPresetCompiler";
export type {
    MotionMove,
    MotionPresetContext,
    MotionPresetRequest,
    MotionProgramRange,
    MotionProgramRangeOptions,
    OrbitDirection,
    OrbitMotionParametersInit,
} from "@/authoring/MotionPresetCompiler";
export { MotionAuthoringStore, VIEW_MODE } from "@/store/MotionAuthoringStore";
export type { ViewMode } from "@/store/MotionAuthoringStore";
export { CameraProgramClip, CameraProgramTrack, PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
export type {
    CameraProgramClipInit,
    CameraProgramClipJSON,
    CameraProgramTrackInit,
    CameraProgramTrackJSON,
    MotionClipProgramSource,
    ProgramSource,
    StaticShotProgramSource,
} from "@/camera/CameraProgramTrack";
export { CameraMotionSampler } from "@/camera/CameraMotionSampler";
export type { CameraMotionSink } from "@/camera/CameraMotionSampler";
export type { DirectorPose } from "@/store/CameraStore";
export { CaptureService, VIDEO_MAX_DURATION_SECONDS } from "@/capture/CaptureService";
export { CaptureHelperRegistry } from "@/capture/CaptureHelperRegistry";
export { ObjectMaterialRegistry } from "@/core/ObjectMaterialRegistry";
export { SELECTION_ROLE } from "@/core/SelectionRole";
export type { SelectionRole } from "@/core/SelectionRole";
export type { FramingMeasure, RenderHandles, ShotFramingPose } from "@/capture/CaptureService";
export { FRAME_STATISTICS_SAMPLE_SIZE, FrameStatisticsAnalyzer } from "@/capture/FrameStatistics";
export type { FrameStatistics } from "@/capture/FrameStatistics";
export { HelperVisibilityTransaction } from "@/capture/HelperVisibilityTransaction";
export type { CaptureHelperLifecycle } from "@/capture/HelperVisibilityTransaction";
export { CAPTURE_PRODUCT_KIND } from "@/capture/CaptureProduct";
export type { CaptureProduct, CaptureProductKind } from "@/capture/CaptureProduct";
export { VIDEO_EXPORT_SOURCE, VIDEO_EXPORT_STATE, VideoExportSession } from "@/capture/VideoExportSession";
export type { PlayheadSource, VideoExportSource, VideoExportState } from "@/capture/VideoExportSession";
export { videoExportPolicyFor } from "@/capture/VideoExportSourcePolicy";
export type { VideoExportSourcePolicy, VideoExportStage } from "@/capture/VideoExportSourcePolicy";
export {
    CancelVideoCaptureCommand,
    CaptureFrameCommand,
    CaptureStopVideoCommand,
    CaptureVideoCommand,
    FrameStatisticsQuery,
    registerCaptureCommands,
} from "@/command/captureCommands";
export { OutputGetFormatQuery, SetOutputFormatCommand, registerOutputCommands } from "@/command/outputCommands";
export { ExportDocumentQuery, ImportDocumentCommand, registerDocumentCommands } from "@/command/documentCommands";
export { assembleDeskDocument, DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
export {
    OutputFormat,
    OutputSettings,
    OUTPUT_FORMAT,
    OUTPUT_FORMAT_ORDER,
    outputFormatFor,
} from "@/output/OutputFormat";
export type { OutputFormatId } from "@/output/OutputFormat";
export { OutputFrameGeometry } from "@/output/OutputFrameGeometry";
export type { OutputFrameNdcBounds, OutputFrameRect, OutputFrameSize } from "@/output/OutputFrameGeometry";
export { DOCUMENT_IMPORT_ISSUE_CODE, DocumentImportService } from "@/document/DocumentImportService";
export {
    DOCUMENT_COMPATIBILITY_ISSUE_CODE,
    DOCUMENT_COMPATIBILITY_PATH,
    MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION,
    readDocumentVersion,
} from "@/document/compatibility/DeskDocumentMigration";
export type {
    DeskDocumentMigration,
    DocumentCompatibilityIssueCode,
    DocumentMigrationResult,
} from "@/document/compatibility/DeskDocumentMigration";
export { DocumentMigrationRegistry } from "@/document/compatibility/DocumentMigrationRegistry";
export type { DocumentMigrationPath } from "@/document/compatibility/DocumentMigrationRegistry";
export { DocumentCompatibilityService } from "@/document/compatibility/DocumentCompatibilityService";
export type {
    DocumentCompatibilityResult,
    DocumentMigrationReport,
} from "@/document/compatibility/DocumentCompatibilityService";
export { createBuiltinDocumentMigrationRegistry } from "@/document/compatibility/builtinMigrations";
export { ProgramReviewQuery, registerReviewCommands } from "@/command/reviewCommands";
export { PROGRAM_REVIEW_ISSUE_KIND, ProgramReviewService } from "@/review/ProgramReviewService";
export type {
    ProgramReviewIssue,
    ProgramReviewIssueKind,
    ProgramReviewReport,
    ProgramReviewShot,
} from "@/review/ProgramReviewService";
export { AssetCatalog } from "@/assets/catalog/AssetCatalog";
export { BuiltinAssetProvider, DEFAULT_BUILTIN_ASSET_BASE_URL } from "@/assets/catalog/AssetProvider";
export type { AssetProvider } from "@/assets/catalog/AssetProvider";
export { ASSET_CATEGORY, ASSET_KIND, ASSET_SOURCE } from "@/assets/catalog/AssetEntry";
export type { AssetEntry, AssetKind, AssetSource } from "@/assets/catalog/AssetEntry";
export {
    AssetsListQuery,
    AssetsMountCommand,
    AssetsPlaceCommand,
    registerAssetCatalogCommands,
} from "@/command/assetCatalogCommands";
export type {
    DeskDocument,
    DeskDocumentAction,
    DeskDocumentActionMount,
    DeskDocumentMotion,
    DeskDocumentOutput,
} from "@/document/DeskDocument";
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
    BindMotionClipFollowCommand,
    CameraMotionGetQuery,
    CreateMotionClipCommand,
    CreateMotionTakeCommand,
    EnterMotionPreviewCommand,
    ExitMotionPreviewCommand,
    MoveMotionKeyCommand,
    PROGRAM_FOLLOW,
    QuickAuthorMotionCommand,
    RemoveMotionClipCommand,
    ReplaceMotionClipCommand,
    RemoveMotionKeyCommand,
    RemoveProgramClipCommand,
    ResetMotionKeyHandlesCommand,
    registerCameraMotionCommands,
    SetMotionClipFocusCommand,
    SetMotionClipFollowParamsCommand,
    SetMotionClipRangeCommand,
    SetMotionKeyCommand,
    SetMotionClipEasingCommand,
    SetMotionKeyHandleCommand,
    SetProgramClipCommand,
    SetViewModeCommand,
    SetSweepPathVisibleCommand,
    UnbindMotionClipFollowCommand,
} from "@/command/cameraMotionCommands";
export type { ProgramFollow } from "@/command/cameraMotionCommands";
export { CommandHistory } from "@/command/CommandHistory";
export type { HistoryEntry } from "@/command/CommandHistory";
export { COMMAND_ERROR, CommandDispatcher } from "@/command/CommandDispatcher";
export {
    ClearSceneCommand,
    MoveObjectCommand,
    PlaceObjectCommand,
    registerBuiltinCommands,
    RemoveObjectCommand,
    SetCameraShotCommand,
} from "@/command/commands";
export {
    AddTimelineKeyCommand,
    FitTimelineDurationCommand,
    MoveTimelineKeyCommand,
    RemoveTimelineKeyCommand,
    RetimeTimelineTrackCommand,
    RestoreTimelineTracksCommand,
    ScaleTimelineCommand,
    SetTimelineDurationCommand,
    SetTimelineKeyEasingCommand,
    SetTimelinePlaybackRangeCommand,
    SetTimelineTrackCommand,
    SetTimelineKeyCommand,
    SetTimelineTrackPoliciesCommand,
    registerTimelineCommands,
} from "@/command/timelineCommands";
export { DirectorCommand } from "@/command/DirectorCommand";
export {
    ActivateShotCommand,
    DeactivateShotCommand,
    registerCameraCommands,
    RemoveShotCommand,
    CameraCheckFramingQuery,
    CameraFrameSubjectCommand,
    CameraListShotsQuery,
} from "@/command/cameraCommands";
export {
    MountActionCommand,
    SetActionRangeCommand,
    registerActionCommands,
    TransportPauseCommand,
    TransportPlayCommand,
    TransportSeekCommand,
    UnmountActionCommand,
    UnmountActionPerformanceCommand,
    TransportStopCommand,
    TransportGetStateQuery,
} from "@/command/actionCommands";
export type {
    CommandExecutionLifecycle,
    CommandIssue,
    CommandIssueOption,
    CommandResult,
    DirectorContext,
    SerializedCommand,
} from "@/command/DirectorCommand";
export type { CommandCapability, DirectorQuery, QueryResult } from "@/command/CommandDispatcher";
export type { DispatchOptions } from "@/command/CommandDispatcher";
export { EMPTY_PAYLOAD_CONTRACT, nullable, TRANSFORM_SCHEMA, VEC3_SCHEMA } from "@/command/PayloadContract";
export { AgentBridge } from "@/ai/AgentBridge";
export type {
    AgentBridgeOptions,
    AgentToolFailure,
    AgentToolInputSchema,
    AgentToolInvocation,
    AgentToolInvocationResult,
    AgentToolSchema,
} from "@/ai/AgentBridge";
export type { ContractViolation, PayloadContract, PayloadFieldSchema } from "@/command/PayloadContract";
export {
    PLACEMENT_RELATION,
    PlaceRelativeCommand,
    PlacementCompiler,
    registerPlacementCommands,
} from "@/command/placementCommands";
export type { PlacementRelation } from "@/command/placementCommands";
export { registerStageCommands, STAGE_PRESET, StagePresetCompiler, StageSceneCommand } from "@/command/stageCommands";
export type { StagePresetId, StageSlotBinding, StageSlotSpec } from "@/command/stageCommands";
export { registerSceneIdentityCommands, SetSceneIdentityCommand } from "@/command/sceneIdentityCommands";
export { InspectDeskQuery, registerPerceptionCommands } from "@/command/perceptionCommands";
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
    ACTOR_METERS_SCALE,
    RELATIVE_SPATIAL_SCALE,
    SCENE_NARRATIVE_ROLE,
    SCENE_SPATIAL_SCALE_KIND,
    SceneNarrativeIdentity,
    SceneSpatialScale,
    scaleForReferenceMaxDimension,
} from "@/core/SceneSemantics";
export type {
    SceneNarrativeIdentityInit,
    SceneNarrativeRole,
    SceneSpatialScaleInit,
    SceneSpatialScaleKind,
} from "@/core/SceneSemantics";
export { DirectorDeskPerceptionService, DESK_PERCEPTION_DETAIL } from "@/perception/DirectorDeskPerceptionService";
export type {
    DeskPerceptionCoordinateSystem,
    DeskPerceptionDetail,
    DeskPerceptionRequest,
} from "@/perception/DirectorDeskPerceptionService";
export { SceneInspectionService } from "@/command/SceneInspectionService";
export type { SceneEntityInspection } from "@/command/SceneInspectionService";
export {
    createDefaultLightParams,
    isLightColor,
    isLightDecay,
    isLightDistance,
    isLightIntensity,
    isLightParams,
    isLightPenumbra,
    isLightType,
    isSpotAngleDegrees,
    LIGHT_DECAY_MAX,
    LIGHT_DECAY_MIN,
    LIGHT_DISTANCE_MAX_METERS,
    LIGHT_DISTANCE_MIN_METERS,
    LIGHT_INTENSITY_MAX,
    LIGHT_INTENSITY_MIN,
    LIGHT_PENUMBRA_MAX,
    LIGHT_PENUMBRA_MIN,
    LIGHT_SPOT_ANGLE_MAX_DEGREES,
    LIGHT_SPOT_ANGLE_MIN_DEGREES,
    LIGHT_TYPES,
    normalizeLightParams,
    retypeLightParams,
} from "@/core/LightParams";
export type {
    DirectionalLightParams,
    LightParams,
    LightType,
    PointLightParams,
    SpotLightParams,
} from "@/core/LightParams";
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
export { TimelineSelectionStore } from "@/store/TimelineSelectionStore";
export { WorkbenchLayoutStore } from "@/store/WorkbenchLayoutStore";
export {
    GRID_SIZE,
    isGridSizeValid,
    isRenderQuality,
    isStudioEnvironmentJSON,
    RENDER_QUALITY,
    RENDER_QUALITY_PROFILES,
    STUDIO_ENVIRONMENT_DEFAULTS,
    StudioEnvironment,
} from "@/studio/StudioEnvironment";
export type { RenderQuality, StudioEnvironmentJSON } from "@/studio/StudioEnvironment";
export {
    registerStudioCommands,
    SetStudioFrameRateVisibleCommand,
    SetStudioGridSizeCommand,
    SetStudioOutputGridVisibleCommand,
    SetStudioRenderQualityCommand,
    StudioGetQuery,
} from "@/command/studioCommands";
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
export type { TimelinePlaybackRangeSource } from "@/time/TimeTransport";
export { TimelineDoc, DEFAULT_TIMELINE_DURATION_SECONDS } from "@/timeline/TimelineDoc";
export type { TimelineDocInit } from "@/timeline/TimelineDoc";
export { TimelineTrack, TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
export { registerKeyframeCodec, keyframeCodecFor } from "@/timeline/keyframeCodecs";
export type { KeyframeCodec } from "@/timeline/keyframeCodecs";
export type { TimelineTrackInit, TimelineTrackKind } from "@/timeline/TimelineTrack";
export { TransformKeyframe } from "@/timeline/TransformKeyframe";
export type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";
export { buildTransformTrajectory } from "@/timeline/transformTrajectory";
export {
    TrackPolicies,
    EXTRAPOLATION_MODE,
    GROUNDING_MODE,
    GROUND_HEIGHT_METERS,
    LOCOMOTION_MODE,
    ORIENTATION_MODE,
    DEFAULT_STRIDE_METERS,
} from "@/timeline/TrackPolicies";
export type {
    ExtrapolationMode,
    GroundingMode,
    LocomotionMode,
    OrientationMode,
    TrackPoliciesInit,
} from "@/timeline/TrackPolicies";
export {
    TimelineSampler,
    createTransformSample,
    evaluateTimelineTransform,
    evaluateTransformTrack,
} from "@/timeline/TimelineSampler";
export type { TransformSample } from "@/timeline/TimelineSampler";
export { PlaybackCoordinator } from "@/timeline/PlaybackCoordinator";
export type { TimelineInvalidator } from "@/timeline/PlaybackCoordinator";
export { createDirectorDeskStores, DirectorDeskProvider, useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
export type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
export { DirectorDesk } from "@/ui/shell/DirectorDesk";
export type { DirectorDeskProps } from "@/ui/shell/DirectorDesk";
export { CAPTURE_FEEDBACK, DeskShellPresentation, ToolbarExtension } from "@/ui/shell/DeskShellPresentation";
export type {
    CaptureActionPresentationInit,
    CaptureFeedback,
    CaptureVideoPresentationInit,
    DeskShellPresentationInit,
    ToolbarExtensionInit,
} from "@/ui/shell/DeskShellPresentation";
export { TimelinePanel } from "@/ui/timeline/TimelinePanel";
