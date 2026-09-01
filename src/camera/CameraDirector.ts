import { entries, makeAutoObservable, observable } from "mobx";

import type { CameraShot } from "@/camera/CameraShot";

/**
 * 机位管理器:多机位注册、激活机位切换、导演视角回退。
 * 阶段一仅做静态机位管理;运镜轨迹属阶段二,不在此处扩展。
 */
export class CameraDirector {
    private readonly shots = observable.map<string, CameraShot>();
    private currentActiveId: string | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    /** 激活机位 id(observable);CameraStore 经此暴露,不再手动镜像 */
    get activeId(): string | null {
        return this.currentActiveId;
    }

    addShot(id: string, shot: CameraShot): void {
        this.shots.set(id, shot);
    }
    /** 文档导入专用：替换整个机位聚合并退出旧掌镜态。 */
    replaceShots(shots: readonly [string, CameraShot][]): void {
        this.currentActiveId = null;
        this.shots.replace(shots);
    }
    getShot(id: string): CameraShot | undefined {
        return this.shots.get(id);
    }

    removeShot(id: string): void {
        if (this.currentActiveId === id) this.currentActiveId = null;
        this.shots.delete(id);
    }

    activate(id: string): CameraShot {
        const shot = this.shots.get(id);
        if (!shot) throw new Error(`CameraDirector: unknown shot "${id}"`);
        this.currentActiveId = id;
        return shot;
    }

    /** 回到导演视角(无激活机位) */
    deactivate(): void {
        this.currentActiveId = null;
    }

    get activeShot(): CameraShot | null {
        return this.currentActiveId ? (this.shots.get(this.currentActiveId) ?? null) : null;
    }

    listShots(): readonly [string, CameraShot][] {
        return entries(this.shots);
    }
}
