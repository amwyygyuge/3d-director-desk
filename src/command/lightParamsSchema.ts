import { LIGHT_TYPES } from "@/core/LightParams";
import type { PayloadFieldSchema } from "@/command/PayloadContract";

const BASE_LIGHT_PROPERTIES = {
    type: { type: "string", enum: LIGHT_TYPES },
    color: { type: "string" },
    intensity: { type: "number" },
} as const satisfies Record<string, PayloadFieldSchema>;

const LOCAL_LIGHT_PROPERTIES = {
    ...BASE_LIGHT_PROPERTIES,
    distance: { type: "number" },
    decay: { type: "number" },
} as const satisfies Record<string, PayloadFieldSchema>;

/** 命令契约的灯型判别联合；结构检查与领域范围检查分层，AI 可直接发现完整输入形状。 */
export const LIGHT_PARAMS_SCHEMA: PayloadFieldSchema = {
    anyOf: [
        {
            type: "object",
            properties: { ...BASE_LIGHT_PROPERTIES, type: { type: "string", enum: ["directional"] } },
            required: ["type", "color", "intensity"],
        },
        {
            type: "object",
            properties: { ...LOCAL_LIGHT_PROPERTIES, type: { type: "string", enum: ["point"] } },
            required: ["type", "color", "intensity", "distance", "decay"],
        },
        {
            type: "object",
            properties: {
                ...LOCAL_LIGHT_PROPERTIES,
                type: { type: "string", enum: ["spot"] },
                angleDegrees: { type: "number" },
                penumbra: { type: "number" },
            },
            required: ["type", "color", "intensity", "distance", "decay", "angleDegrees", "penumbra"],
        },
    ],
};
