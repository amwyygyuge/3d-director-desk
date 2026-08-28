import { makeAutoObservable } from "mobx";

import { CameraDirector } from "../camera/CameraDirector";
import { type CameraShot } from "../camera/CameraShot";
import type { Vec3 } from "../core/SceneObject";

/** 导演视角 pose:纯数据,激活机位前暂存,回导演视角时精确还原 */
export interface DirectorPose {
    position: Vec3;
    target: Vec3;
    fov: number;
}

/** 机位 Store:CameraDirector 管理器为引擎,本类只暴露可观察的激活态与版本号 */
export class CameraStore {
    readonly director = new CameraDirector();
    activeShotId: string | null = null;
    /** 机位表版本号:shots Map 非 observable,锚定它驱动面板重渲(同 SceneStore 先例) */
    revision = 0;
    /** 最近一次导演视角 pose(轨道交互结束时由 ShotCameraRig 记录);高频写,排除 observable */
    lastDirectorPose: DirectorPose | null = null;

    constructor() {
        makeAutoObservable(this, { director: false, lastDirectorPose: false });
    }

    addShot(id: string, shot: CameraShot): void {
        this.director.addShot(id, shot);
        this.revision += 1;
    }

    removeShot(id: string): void {
        this.director.removeShot(id);
        if (this.activeShotId === id) this.activeShotId = null;
        this.revision += 1;
    }

    activateShot(id: string): void {
        this.director.activate(id);
        this.activeShotId = id;
    }

    backToDirectorView(): void {
        this.director.deactivate();
        this.activeShotId = null;
    }

    rememberDirectorPose(pose: DirectorPose): void {
        this.lastDirectorPose = pose;
    }

    get activeShot(): CameraShot | null {
        return this.director.activeShot;
    }
}
