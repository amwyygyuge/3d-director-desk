import { makeAutoObservable } from "mobx";

import { CameraDirector } from "../camera/CameraDirector";
import { type CameraShot } from "../camera/CameraShot";

/** 机位 Store:CameraDirector 管理器为引擎,本类只暴露可观察的激活态 */
export class CameraStore {
    readonly director = new CameraDirector();
    activeShotId: string | null = null;

    constructor() {
        makeAutoObservable(this, { director: false });
    }

    activateShot(id: string): void {
        this.director.activate(id);
        this.activeShotId = id;
    }

    backToDirectorView(): void {
        this.director.deactivate();
        this.activeShotId = null;
    }

    get activeShot(): CameraShot | null {
        return this.director.activeShot;
    }
}
