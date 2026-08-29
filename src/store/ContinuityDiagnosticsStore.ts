import { makeAutoObservable, observableRef, reaction } from "mobx";

import type { ContinuityIssue } from "../camera/ContinuityChecker";
import type { CameraStore } from "./CameraStore";
import type { SceneStore } from "./SceneStore";
import type { TimelineStore } from "./TimelineStore";

const EMPTY_ISSUES: readonly ContinuityIssue[] = Object.freeze([]);

export interface ContinuityDiagnosticRequest {
    readonly subjectId: string;
    readonly shotIds: readonly string[];
    readonly sampleTimes: readonly number[];
    readonly teleportThreshold: number;
}

/** Per-desk, non-persistent presentation state for the most recent continuity query. */
export class ContinuityDiagnosticsStore {
    private currentIssues: readonly ContinuityIssue[] = EMPTY_ISSUES;
    private currentRequest: ContinuityDiagnosticRequest | null = null;
    private currentSourceSignature: string | null = null;
    private readonly disposeInvalidation: () => void;
    private readonly scene: SceneStore;
    private readonly camera: CameraStore;
    private readonly timeline: TimelineStore;

    constructor(scene: SceneStore, camera: CameraStore, timeline: TimelineStore) {
        this.scene = scene;
        this.camera = camera;
        this.timeline = timeline;
        makeAutoObservable<ContinuityDiagnosticsStore, "currentIssues" | "currentRequest" | "currentSourceSignature" | "disposeInvalidation" | "scene" | "camera" | "timeline" | "sourceSignature">(this, {
            currentIssues: observableRef,
            currentRequest: observableRef,
            currentSourceSignature: false,
            disposeInvalidation: false,
            scene: false,
            camera: false,
            timeline: false,
            sourceSignature: false,
        });
        this.disposeInvalidation = reaction(
            () => this.sourceSignature(),
            (signature) => {
                if (signature !== this.currentSourceSignature) this.clear();
            },
        );
    }

    get issues(): readonly ContinuityIssue[] {
        return this.currentIssues;
    }

    present(request: ContinuityDiagnosticRequest, issues: readonly ContinuityIssue[]): void {
        this.currentRequest = Object.freeze({
            subjectId: request.subjectId,
            shotIds: Object.freeze([...request.shotIds]),
            sampleTimes: Object.freeze([...request.sampleTimes]),
            teleportThreshold: request.teleportThreshold,
        });
        this.currentSourceSignature = this.sourceSignature();
        this.currentIssues = Object.freeze([...issues]);
    }

    clear(): void {
        this.currentIssues = EMPTY_ISSUES;
        this.currentRequest = null;
        this.currentSourceSignature = null;
    }

    dispose(): void {
        this.disposeInvalidation();
        this.clear();
    }

    private sourceSignature(): string | null {
        const request = this.currentRequest;
        if (!request) return null;
        const subject = this.scene.manager.getEntity(request.subjectId);
        return JSON.stringify({
            subject: subject?.transform ?? null,
            shots: request.shotIds.map((id) => this.camera.director.getShot(id)?.toJSON() ?? null),
            timeline: this.timeline.document.toJSON(),
        });
    }
}
