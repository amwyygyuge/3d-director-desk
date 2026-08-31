import { makeAutoObservable } from "mobx";
import type { Object3D } from "three";

import { CameraDirector } from "../camera/CameraDirector";
import { type CameraShot } from "../camera/CameraShot";
import type { Vec3 } from "../core/SceneObject";

/** 导演视角 pose:纯数据,激活机位前暂存,回导演视角时精确还原 */
export interface DirectorPose {
    position: Vec3;
    target: Vec3;
    fov: number;
}

function nextAvailableShotName(used: ReadonlySet<string>, serial = 1): string {
    const candidate = `机位 ${String(serial).padStart(2, "0")}`;
    return used.has(candidate) ? nextAvailableShotName(used, serial + 1) : candidate;
}

/** Camera registry plus free-director pose. Preview and Program selection live in CameraAuthoringStore. */
export class CameraStore {
    readonly director = new CameraDirector();
    /** 最近一次导演视角 pose(轨道交互结束时由 ShotCameraRig 记录)。 */
    lastDirectorPose: DirectorPose | null = null;
    /** Camera previews are editor-local; the domain has no active camera. Retained for legacy helper suppression only. */
    get activeShotId(): null {
        return null;
    }
    /** 取景请求序号:rig 锚定它应用 directorPoseTarget。 */
    directorPoseNonce = 0;
    /** 取景目标 pose(纯数据请求,由 rig 消费);排除 observable。 */
    directorPoseTarget: DirectorPose | null = null;
    /** 机位标记运行时引用(场景内摄像机模型的 Object3D);普通 Map,永不进 observable。 */
    readonly markerRuntimes = new Map<string, Object3D>();

    constructor() {
        makeAutoObservable(this, { director: false, directorPoseTarget: false, markerRuntimes: false });
    }

    registerShotMarker(id: string, object3d: Object3D): void {
        this.markerRuntimes.set(id, object3d);
    }

    unregisterShotMarker(id: string): void {
        this.markerRuntimes.delete(id);
    }

    nextShotName(): string {
        const used = new Set([...this.director.listShots()].map(([id]) => id));
        return nextAvailableShotName(used);
    }

    requestDirectorPose(pose: DirectorPose): void {
        this.directorPoseTarget = pose;
        this.directorPoseNonce += 1;
    }

    addShot(id: string, shot: CameraShot): void {
        this.director.addShot(id, shot);
    }

    removeShot(id: string): void {
        this.director.removeShot(id);
    }

    rememberDirectorPose(pose: DirectorPose): void {
        this.lastDirectorPose = pose;
    }
}
