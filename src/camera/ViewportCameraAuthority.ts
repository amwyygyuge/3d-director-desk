import { makeAutoObservable } from "mobx";

import type { CameraStore } from "@/store/CameraStore";
import type { MotionAuthoringStore } from "@/store/MotionAuthoringStore";

/**
 * 视口相机的三种所有权。互斥且完备:同一时刻只有一个所有者能收指针/按键并写数据。
 */
export const VIEWPORT_CAMERA_OWNER = {
    /** 自由导演机:轨道控制器驱动,手势不写任何领域数据 */
    DIRECTOR: "director",
    /** 掌镜:摆位手势落 camera.set-shot */
    SHOT: "shot",
    /** 成片输出(全屏预览 / 镜头视角):相机由采样器接管,摆位手势落 motion.set-key */
    PROGRAM: "program",
} as const;
export type ViewportCameraOwner = (typeof VIEWPORT_CAMERA_OWNER)[keyof typeof VIEWPORT_CAMERA_OWNER];

/**
 * 视口相机所有权的唯一裁决点(每桌一套)。
 *
 * 背景:三条导航路径(FlyDrive / ShotNavigation / LensNavigation)与 OrbitControls 曾各自
 * 推断激活条件,判据互不互斥——镜头视角下 FlyDrive 与 LensNavigation 同时吃 WASD(位移翻倍),
 * 轨道控制器又与摆位手势抢同一串指针事件(公转叠加 pan/tilt、滚轮既推轨又变焦、阻尼惯性
 * 污染松手后的落帧)。所有权收敛在此,消费方只读不推断。
 */
export class ViewportCameraAuthority {
    /** 瞬态让位计数:关键帧小球 / gizmo 拖拽期轨道必须停手,手势可叠加故计数而非布尔 */
    private orbitSuspensions = 0;

    constructor(
        private readonly camera: CameraStore,
        private readonly authoring: MotionAuthoringStore,
    ) {
        makeAutoObservable<ViewportCameraAuthority, "camera" | "authoring">(this, {
            camera: false,
            authoring: false,
        });
    }

    /** 成片接管优先于掌镜:镜头视角/全屏预览下相机归采样器,机位钉参必须让位。 */
    get owner(): ViewportCameraOwner {
        if (this.authoring.programOutputActive) return VIEWPORT_CAMERA_OWNER.PROGRAM;
        return this.camera.activeShotId === null ? VIEWPORT_CAMERA_OWNER.DIRECTOR : VIEWPORT_CAMERA_OWNER.SHOT;
    }

    /** 自由导演机:轨道公转 + 飞行,手势不落命令 */
    get isDirectorFree(): boolean {
        return this.owner === VIEWPORT_CAMERA_OWNER.DIRECTOR;
    }

    /** 掌镜摆位:pan/tilt + 飞行 + 变焦,落 camera.set-shot */
    get isShotOperating(): boolean {
        return this.owner === VIEWPORT_CAMERA_OWNER.SHOT;
    }

    /** 镜头视角摆位:成片接管且仍在编辑态(全屏预览是只读的) */
    get isLensAuthoring(): boolean {
        return this.owner === VIEWPORT_CAMERA_OWNER.PROGRAM && this.authoring.lensViewActive;
    }

    /** OrbitControls 启停的唯一判据:导演视角且无手势让位 */
    get isOrbitEnabled(): boolean {
        return this.isDirectorFree && this.orbitSuspensions === 0;
    }

    suspendOrbit(): void {
        this.orbitSuspensions += 1;
    }

    resumeOrbit(): void {
        this.orbitSuspensions = Math.max(0, this.orbitSuspensions - 1);
    }
}
