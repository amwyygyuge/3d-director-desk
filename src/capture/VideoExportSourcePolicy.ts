import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import type { VideoExportSource } from "@/capture/VideoExportSession";

/** 导出策略只需控制预览态与循环，不依赖完整 DirectorContext，避免命令层反向循环。 */
export interface VideoExportStage {
    readonly layout: {
        readonly presentationMode: boolean;
        setPresentationMode(active: boolean): void;
    };
    readonly clock: {
        readonly isLooping: boolean;
        setLooping(looping: boolean): void;
    };
}

export interface VideoExportSourcePolicy {
    prepare(stage: VideoExportStage): void;
    restore(stage: VideoExportStage): void;
}

/** 成片输出必须由预览态接管相机，避免把编辑辅助物录入产品。 */
export class ProgramSourcePolicy implements VideoExportSourcePolicy {
    private previousPresentationMode: boolean | null = null;
    private previousLooping: boolean | null = null;

    prepare(stage: VideoExportStage): void {
        this.previousPresentationMode = stage.layout.presentationMode;
        this.previousLooping = stage.clock.isLooping;
        stage.clock.setLooping(false);
        stage.layout.setPresentationMode(true);
    }

    restore(stage: VideoExportStage): void {
        if (this.previousLooping === null || this.previousPresentationMode === null) return;
        stage.layout.setPresentationMode(this.previousPresentationMode);
        stage.clock.setLooping(this.previousLooping);
        this.previousPresentationMode = null;
        this.previousLooping = null;
    }
}

/** 当前视角导出保留编辑画面，仅临时关闭循环以保证任务拥有明确尾部。 */
export class ViewportSourcePolicy implements VideoExportSourcePolicy {
    private previousLooping: boolean | null = null;

    prepare(stage: VideoExportStage): void {
        this.previousLooping = stage.clock.isLooping;
        stage.clock.setLooping(false);
    }

    restore(stage: VideoExportStage): void {
        if (this.previousLooping === null) return;
        stage.clock.setLooping(this.previousLooping);
        this.previousLooping = null;
    }
}

const VIDEO_EXPORT_POLICY_FACTORIES: Record<VideoExportSource, () => VideoExportSourcePolicy> = {
    [VIDEO_EXPORT_SOURCE.PROGRAM]: () => new ProgramSourcePolicy(),
    [VIDEO_EXPORT_SOURCE.VIEWPORT]: () => new ViewportSourcePolicy(),
};

export function videoExportPolicyFor(source: VideoExportSource): VideoExportSourcePolicy {
    return VIDEO_EXPORT_POLICY_FACTORIES[source]();
}
