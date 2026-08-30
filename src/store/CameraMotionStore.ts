import { makeAutoObservable } from "mobx";

import { CameraMotionPath } from "../camera/CameraMotionPath";
import type { MotionKey } from "../camera/CameraMotionPath";

/** Per-DirectorDesk serializable motion state; a desk has at most one director path. */
export class CameraMotionStore {
    private currentPath: CameraMotionPath | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    get path(): CameraMotionPath | null {
        return this.currentPath;
    }

    addKey(key: MotionKey): void {
        this.currentPath = (this.currentPath ?? new CameraMotionPath({ keys: [] })).withKey(key);
    }

    moveKey(keyId: string, timeSeconds: number): void {
        const key = this.currentPath?.key(keyId);
        if (!key || !this.currentPath) return;
        this.currentPath = this.currentPath.withKey(key.withTime(timeSeconds));
    }

    setKeyEasing(keyId: string, easing: MotionKey["easing"]): void {
        const key = this.currentPath?.key(keyId);
        if (!key || !this.currentPath) return;
        this.currentPath = this.currentPath.withKey(key.withEasing(easing));
    }

    removeKey(keyId: string): void {
        this.currentPath = this.currentPath?.withoutKey(keyId) ?? null;
    }
    /** 文档导入的整树恢复(同 TimelineStore.restoreTracks 先例) */
    restorePath(path: CameraMotionPath | null): void {
        this.currentPath = path;
    }
}
