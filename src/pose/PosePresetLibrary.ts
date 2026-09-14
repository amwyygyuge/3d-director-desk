import { makeAutoObservable, observable } from "mobx";

import type { BodyPart } from "@/actor/actorSkeleton";
import { PosePreset } from "@/pose/PosePreset";
import { BUILTIN_POSE_PRESETS } from "@/pose/posePresets.data";

/** Per-desk preset registry; built-ins are immutable while document-owned entries stay observable. */
export class PosePresetLibrary {
    private readonly builtins = new Map(BUILTIN_POSE_PRESETS.map((preset) => [preset.id, new PosePreset(preset)]));
    private readonly custom = observable.map<string, PosePreset>();

    constructor() {
        makeAutoObservable<PosePresetLibrary, "builtins">(this, { builtins: false });
    }

    list(part?: BodyPart): readonly PosePreset[] {
        const all = [...this.builtins.values(), ...this.custom.values()];
        return part === undefined ? all : all.filter((preset) => preset.part === part);
    }

    get(id: string): PosePreset | undefined {
        return this.builtins.get(id) ?? this.custom.get(id);
    }

    registerCustom(preset: PosePreset): void {
        if (this.builtins.has(preset.id)) {
            throw new Error(`PosePresetLibrary: 不能覆盖内置预设 ${preset.id}`);
        }
        if (!preset.custom) throw new Error(`PosePresetLibrary: 自建预设必须标记 custom: true (${preset.id})`);
        this.custom.set(preset.id, preset);
    }

    removeCustom(id: string): void {
        this.custom.delete(id);
    }

    customPresets(): readonly PosePreset[] {
        return [...this.custom.values()];
    }

    replaceCustom(presets: readonly PosePreset[]): void {
        const next = new Map<string, PosePreset>();
        for (const preset of presets) {
            if (this.builtins.has(preset.id)) {
                throw new Error(`PosePresetLibrary: 文档预设与内置预设冲突 ${preset.id}`);
            }
            if (!preset.custom) throw new Error(`PosePresetLibrary: 文档预设必须标记 custom: true (${preset.id})`);
            next.set(preset.id, preset);
        }
        this.custom.replace(next);
    }
}
