import { CAPTURE_PRODUCT_KIND } from "@/capture/CaptureProduct";
import {
    CAPTURE_PROFILE_IDS,
    CAPTURE_SCOPE,
    CAPTURE_SHADING,
    captureProfile,
    isCaptureProfileId,
} from "@/capture/CaptureProfile";
import type { CaptureProfile } from "@/capture/CaptureProfile";
import type { HandoffBundle } from "@/capture/HandoffBundle";
import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import {
    CaptureVideoCommand,
    deliverCaptureProduct,
    exportVideoAndDeliver,
    videoRangeFor,
} from "@/command/captureCommands";
import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import type { PayloadContract } from "@/command/PayloadContract";
import { compositionInputFor } from "@/command/promptCommands";
import { createId } from "@/core/createId";
import { ScenePromptSynthesizer } from "@/prompt/ScenePromptSynthesizer";

const BUNDLE_VERSION = "1" as const;
const BUNDLE_PERMISSION = "capture:write";
const BUNDLE_APPLIES_WHEN = "director-desk.capture-v1";
const synthesizer = new ScenePromptSynthesizer();

interface CaptureBundlePayload {
    readonly profileId: string;
    /** AI 连发/重试时按 requestId 对账产物归属(与产物内 bundle 同源) */
    readonly requestId?: string;
}

const BUNDLE_CONTRACT: PayloadContract = {
    properties: {
        profileId: { type: "string", enum: [...CAPTURE_PROFILE_IDS] },
        requestId: { type: "string" },
    },
    required: ["profileId"],
};

/** 交接包同步部分:呈现档 + 合成文本条件 + 被摄体身份;RGB 产物异步经 requestId 与之对齐 */
function buildHandoffBundle(ctx: DirectorContext, profile: CaptureProfile): HandoffBundle {
    const input = compositionInputFor(ctx);
    const synthesized = profile.includePrompt ? synthesizer.synthesize(input) : null;
    return {
        profileId: profile.id,
        scope: profile.scope,
        shading: profile.shading,
        prompt: synthesized?.prompt ?? null,
        facets: synthesized?.facets ?? null,
        subjects: input.subjects.map((subject) => ({ id: subject.id, name: subject.name })),
    };
}

/**
 * 采集交接包命令(C1 交接面):一次编排按呈现档出对齐产物——
 * i2v-hero 出中性首帧,v2v-clip 出中性参考片,二者都封入合成文本条件与被摄体身份。
 * 着色/取景/文本三事收敛在呈现档;渲染管线与产物出口复用既有采集路径(禁另起一套)。
 */
export class CaptureBundleCommand extends DirectorCommand<CaptureBundlePayload> {
    static readonly TYPE = "capture.bundle";
    readonly type = CaptureBundleCommand.TYPE;

    constructor(readonly payload: CaptureBundlePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isCaptureProfileId(this.payload.profileId)) {
            return [{ code: "capture-unknown-profile", path: "profileId", message: `未知采集档 "${this.payload.profileId}"` }];
        }
        const profile = captureProfile(this.payload.profileId);
        if (profile.scope === CAPTURE_SCOPE.REFERENCE_CLIP) {
            return new CaptureVideoCommand({ source: VIDEO_EXPORT_SOURCE.PROGRAM }).validateIssues(ctx);
        }
        return ctx.capture.isAttached
            ? []
            : [{ code: "capture-renderer-unavailable", path: "capture", message: "渲染器未就绪(Canvas 尚未 onCreated)" }];
    }

    execute(ctx: DirectorContext): void {
        if (!isCaptureProfileId(this.payload.profileId)) return;
        const profile = captureProfile(this.payload.profileId);
        const requestId = this.payload.requestId ?? createId();
        const bundle = buildHandoffBundle(ctx, profile);
        const neutralShading = profile.shading === CAPTURE_SHADING.NEUTRAL;
        if (profile.scope === CAPTURE_SCOPE.HERO_FRAME) {
            this.captureHeroFrame(ctx, { requestId, neutralShading, bundle });
            return;
        }
        void exportVideoAndDeliver(ctx, {
            source: VIDEO_EXPORT_SOURCE.PROGRAM,
            requestId,
            ...videoRangeFor(ctx, {}),
            neutralShading,
            bundle,
        });
    }

    private captureHeroFrame(
        ctx: DirectorContext,
        options: { readonly requestId: string; readonly neutralShading: boolean; readonly bundle: HandoffBundle },
    ): void {
        void ctx.capture.capture({ hideHelpers: true, neutralShading: options.neutralShading }).then(async (blob) => {
            if (!blob) return;
            await deliverCaptureProduct(ctx, {
                kind: CAPTURE_PRODUCT_KIND.IMAGE,
                blob,
                requestId: options.requestId,
                durationSeconds: null,
                bundle: options.bundle,
            });
        });
    }
}

function capability(): CommandCapability {
    return {
        type: CaptureBundleCommand.TYPE,
        version: BUNDLE_VERSION,
        kind: "command",
        permissions: [BUNDLE_PERMISSION],
        appliesWhen: BUNDLE_APPLIES_WHEN,
        payload: BUNDLE_CONTRACT,
    };
}

export function registerBundleCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(CaptureBundleCommand.TYPE, (payload: CaptureBundlePayload) => new CaptureBundleCommand(payload), capability());
}
