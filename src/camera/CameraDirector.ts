import { entries, makeAutoObservable, observable } from "mobx";

import type { CameraShot } from "./CameraShot";

/** Camera registry. Viewport preview selection belongs to CameraAuthoringStore, never this domain registry. */
export class CameraDirector {
    private readonly shots = observable.map<string, CameraShot>();

    constructor() {
        makeAutoObservable(this);
    }

    addShot(id: string, shot: CameraShot): void {
        this.shots.set(id, shot);
    }

    getShot(id: string): CameraShot | undefined {
        return this.shots.get(id);
    }

    removeShot(id: string): void {
        this.shots.delete(id);
    }

    listShots(): readonly [string, CameraShot][] {
        return entries(this.shots);
    }
}
