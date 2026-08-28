// 公共出口:宿主(Monet 插件壳)只从这里消费
import "./styles/index.css";

export { AnimationBinder } from "./animation/AnimationBinder";
export { HostBridge } from "./bridge/HostBridge";
export { connectBridgeCommands } from "./bridge/connectBridgeCommands";
export { isDirectorDeskMessage } from "./bridge/protocol";
export type { HostInboundMessage, HostOutboundMessage } from "./bridge/protocol";
export { CameraDirector } from "./camera/CameraDirector";
export { CameraShot, SHOT_SIZE } from "./camera/CameraShot";
export type { ShotSize } from "./camera/CameraShot";
export { CaptureService } from "./capture/CaptureService";
export { CommandDispatcher } from "./command/CommandDispatcher";
export {
    MoveObjectCommand,
    PlaceObjectCommand,
    registerBuiltinCommands,
    RemoveObjectCommand,
    SetCameraShotCommand,
} from "./command/commands";
export { DirectorCommand } from "./command/DirectorCommand";
export type { CommandResult, DirectorContext, SerializedCommand } from "./command/DirectorCommand";
export { DisposeBag } from "./core/DisposeBag";
export { SceneManager } from "./core/SceneManager";
export { IDENTITY_TRANSFORM, SceneObject } from "./core/SceneObject";
export type { SceneObjectKind, Transform, Vec3 } from "./core/SceneObject";
export { CameraStore } from "./store/CameraStore";
export { SceneStore } from "./store/SceneStore";
export { SelectionStore } from "./store/SelectionStore";
export { TimeTransport } from "./time/TimeTransport";
export { createDirectorDeskStores, DirectorDeskProvider, useDirectorDeskStores } from "./ui/DirectorDeskContext";
export type { DirectorDeskStores } from "./ui/DirectorDeskContext";
export { DirectorDesk } from "./ui/DirectorDesk";
