import type { CameraShot } from "./CameraShot";

/**
 * 机位管理器:多机位注册、激活机位切换、导演视角回退。
 * 阶段一仅做静态机位管理;运镜轨迹属阶段二,不在此处扩展。
 */
export class CameraDirector {
    private readonly shots = new Map<string, CameraShot>();
    private activeId: string | null = null;

    addShot(id: string, shot: CameraShot): void {
        this.shots.set(id, shot);
    }
    getShot(id: string): CameraShot | undefined {
        return this.shots.get(id);
    }

    removeShot(id: string): void {
        if (this.activeId === id) this.activeId = null;
        this.shots.delete(id);
    }

    activate(id: string): CameraShot {
        const shot = this.shots.get(id);
        if (!shot) throw new Error(`CameraDirector: unknown shot "${id}"`);
        this.activeId = id;
        return shot;
    }

    /** 回到导演视角(无激活机位) */
    deactivate(): void {
        this.activeId = null;
    }

    get activeShot(): CameraShot | null {
        return this.activeId ? (this.shots.get(this.activeId) ?? null) : null;
    }

    listShots(): readonly [string, CameraShot][] {
        return [...this.shots.entries()];
    }
}
