// 公共出口:宿主(Monet 插件壳)只从这里消费
import "./styles/index.css";

export { AnimationBinder } from "./animation/AnimationBinder";
export { HostBridge } from "./bridge/HostBridge";
export { isDirectorDeskMessage } from "./bridge/protocol";
export type { HostInboundMessage, HostOutboundMessage } from "./bridge/protocol";
export { CameraDirector } from "./camera/CameraDirector";
export { CameraShot, SHOT_SIZE } from "./camera/CameraShot";
export type { ShotSize } from "./camera/CameraShot";
export { CaptureService } from "./capture/CaptureService";
export { DisposeBag } from "./core/DisposeBag";
export { SceneManager } from "./core/SceneManager";
export { IDENTITY_TRANSFORM, SceneObject } from "./core/SceneObject";
export type { SceneObjectKind, Transform, Vec3 } from "./core/SceneObject";
export { cameraStore, CameraStore } from "./store/CameraStore";
export { sceneStore, SceneStore } from "./store/SceneStore";
export { selectionStore, SelectionStore } from "./store/SelectionStore";
export { DirectorDesk } from "./ui/DirectorDesk";
