import type { CaptureProfileId, CaptureScope, CaptureShading } from "@/capture/CaptureProfile";
import type { PromptFacets } from "@/prompt/ScenePromptSynthesizer";

/** 被摄体身份映射:产物回指场景实体(agent 据此把生成结果与场景对齐) */
export interface HandoffSubjectRef {
    readonly id: string;
    readonly name: string;
}

/**
 * 交接包(值对象,可序列化):一次采集的「同步可算部分」——档、文本条件、被摄体身份。
 * RGB 产物异步经 requestId 对账;本包封进产物元数据,与产物一并抵达 agent,
 * 无需 agent 二次拼装(对齐即 requestId)。多通道(depth/pose/相机轨迹)属 C2,暂不含。
 */
export interface HandoffBundle {
    readonly profileId: CaptureProfileId;
    readonly scope: CaptureScope;
    readonly shading: CaptureShading;
    /** 合成文本条件;profile.includePrompt=false 时为 null */
    readonly prompt: string | null;
    readonly facets: PromptFacets | null;
    readonly subjects: readonly HandoffSubjectRef[];
}
