import { makeAutoObservable } from "mobx";

export const VIEWPORT_MODE = {
    DIRECTOR: "director",
    CAMERA: "camera",
    PROGRAM: "program",
} as const;
export type ViewportMode = (typeof VIEWPORT_MODE)[keyof typeof VIEWPORT_MODE];

export const PATH_EDIT_STATE = {
    IDLE: "idle",
    EDITING_PATH: "editing-path",
    EDITING_FOCUS_OFFSET: "editing-focus-offset",
} as const;
export type PathEditState = (typeof PATH_EDIT_STATE)[keyof typeof PATH_EDIT_STATE];

/** Per-desk authoring selection. It deliberately never aliases scene-object selection or serializes into a document. */
export class CameraAuthoringStore {
    selectedCameraId: string | null = null;
    selectedMotionClipId: string | null = null;
    selectedProgramClipId: string | null = null;
    selectedPathAnchorId: string | null = null;
    viewportMode: ViewportMode = VIEWPORT_MODE.DIRECTOR;
    pathEditState: PathEditState = PATH_EDIT_STATE.IDLE;

    constructor() {
        makeAutoObservable(this);
    }

    selectCamera(cameraId: string | null): void {
        this.selectedCameraId = cameraId;
    }

    selectMotionClip(clipId: string | null): void {
        this.selectedMotionClipId = clipId;
        this.selectedPathAnchorId = null;
        this.pathEditState = clipId === null ? PATH_EDIT_STATE.IDLE : this.pathEditState;
    }

    selectProgramClip(clipId: string | null): void {
        this.selectedProgramClipId = clipId;
    }
    selectPathAnchor(anchorId: string | null): void {
        this.selectedPathAnchorId = anchorId;
    }

    setViewportMode(mode: ViewportMode): void {
        this.viewportMode = mode;
    }

    setPathEditState(state: PathEditState): void {
        this.pathEditState = state;
    }
}
