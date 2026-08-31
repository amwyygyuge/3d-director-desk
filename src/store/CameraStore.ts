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

/** 机位 Store:CameraDirector 管理器为引擎,本类只暴露可观察的激活态与导演 pose */
export class CameraStore {
    readonly director = new CameraDirector();
    /** 激活机位 id:转发 director 的 observable 状态(单一事实源,不手动镜像) */
    get activeShotId(): string | null {
        return this.director.activeId;
    }
    /** 最近一次导演视角 pose(轨道交互结束时由 ShotCameraRig 记录);低频写(轨道结束/飞行结束/初始),保留 observable 让面板可订阅 */
    lastDirectorPose: DirectorPose | null = null;
    /** 取景请求序号:rig 锚定它在非机位视角应用 directorPoseTarget */
    directorPoseNonce = 0;
    /** 取景目标 pose(纯数据请求,由 rig 消费);排除 observable */
    directorPoseTarget: DirectorPose | null = null;
    /** 机位标记运行时引用(场景内摄像机模型的 Object3D);普通 Map,永不进 observable */
    readonly markerRuntimes = new Map<string, Object3D>();

    constructor() {
        makeAutoObservable(this, { director: false, directorPoseTarget: false, markerRuntimes: false });
    }

    /** 机位标记渲染体注册/注销(ShotMarkers 用) */
    registerShotMarker(id: string, object3d: Object3D): void {
        this.markerRuntimes.set(id, object3d);
    }

    unregisterShotMarker(id: string): void {
        this.markerRuntimes.delete(id);
    }

    /** 下一个可读机位名:机位 01、机位 02…(取首个空缺序号,删除后复用) */
    nextShotName(): string {
        const used = new Set([...this.director.listShots()].map(([id]) => id));
        for (let serial = 1; ; serial += 1) {
            const candidate = `机位 ${String(serial).padStart(2, "0")}`;
            if (!used.has(candidate)) return candidate;
        }
    }

    /** 请求导演视角跳到指定 pose(取景命令的落地口;机位视角下 rig 忽略) */
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

    activateShot(id: string): void {
        this.director.activate(id);
    }

    backToDirectorView(): void {
        this.director.deactivate();
    }

    rememberDirectorPose(pose: DirectorPose): void {
        this.lastDirectorPose = pose;
    }

    get activeShot(): CameraShot | null {
        return this.director.activeShot;
    }
}
