/**
 * payload 契约(架构债 D1):命令/查询注册时随 capability 登记,
 * dispatch/query 的最外层做「未知字段 / 缺失必填 / 基础类型与有限性」检查,
 * 同一份契约经 listCapabilities() 派生 AI tool schema——单一真相源,不再手写。
 *
 * 职责分层:契约只管结构(键集/类型/nullable/有限性),业务规则(fov 区间、
 * id 存在性、骨骼兼容)仍归命令 validate()——两层各司其职,不重复表达。
 *
 * schema 取 JSON Schema 子集,保证可直接映射为工具输入 schema。
 */

export type PayloadFieldSchema =
    | { readonly type: "string"; readonly enum?: readonly string[] }
    | { readonly type: "number" }
    | { readonly type: "boolean" }
    | {
          readonly type: "array";
          readonly items?: PayloadFieldSchema;
          readonly minItems?: number;
          readonly maxItems?: number;
      }
    | {
          readonly type: "object";
          readonly properties?: Record<string, PayloadFieldSchema>;
          readonly required?: readonly string[];
      }
    | { readonly type: "null" }
    | { readonly anyOf: readonly PayloadFieldSchema[] };

/** 一条命令/查询的 payload 契约:顶层永远是对象 */
export interface PayloadContract {
    readonly properties: Record<string, PayloadFieldSchema>;
    readonly required?: readonly string[];
}

export interface ContractViolation {
    /** 点路径,如 payload.shot.position;AI 按 path 定位修正 */
    readonly path: string;
    readonly message: string;
}

const CONTRACT_ROOT = "payload";
const EMPTY_PROPERTIES: Record<string, PayloadFieldSchema> = {};

/** 命令 payload 的唯一结构守卫；字段语义仍由各领域 validator 负责。 */
export function isPayloadRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 所有检查器共用的违规包装(6+ 处调用,锁死 issue 形状) */
function violation(path: string, message: string): readonly ContractViolation[] {
    return [{ path, message }];
}

function checkArray(
    path: string,
    schema: { readonly items?: PayloadFieldSchema; readonly minItems?: number; readonly maxItems?: number },
    value: unknown,
): readonly ContractViolation[] {
    if (!Array.isArray(value)) return violation(path, `${path} 应为 array`);
    const lengthIssues =
        (schema.minItems !== undefined && value.length < schema.minItems) ||
        (schema.maxItems !== undefined && value.length > schema.maxItems)
            ? violation(path, `${path} 长度应在 ${schema.minItems ?? 0}~${schema.maxItems ?? "∞"} 之间`)
            : [];
    if (!schema.items) return lengthIssues;
    const itemIssues = value.flatMap((item, index) => checkField(`${path}[${index}]`, schema.items!, item));
    return [...lengthIssues, ...itemIssues];
}

/** 对象节点的三种检查:缺失必填、未知字段、逐字段类型。properties 缺省 = 不约束键集 */
function checkObjectFields(
    path: string,
    shape: { readonly properties?: Record<string, PayloadFieldSchema>; readonly required?: readonly string[] },
    value: unknown,
): readonly ContractViolation[] {
    if (!isPayloadRecord(value)) return violation(path, `${path} 应为 object`);
    const properties = shape.properties ?? EMPTY_PROPERTIES;
    const requiredIssues = (shape.required ?? []).flatMap((key) =>
        value[key] === undefined ? violation(`${path}.${key}`, `缺少必填字段 ${path}.${key}`) : [],
    );
    const unknownIssues =
        shape.properties === undefined
            ? []
            : Object.keys(value).flatMap((key) =>
                  properties[key] === undefined ? violation(`${path}.${key}`, `${path}.${key} 为未知字段`) : [],
              );
    const fieldIssues = Object.entries(properties).flatMap(([key, fieldSchema]) => {
        const fieldValue = value[key];
        // 缺失的非必填字段放行;显式 null 仍过类型检查(nullable 由 anyOf 表达)
        return fieldValue === undefined ? [] : checkField(`${path}.${key}`, fieldSchema, fieldValue);
    });
    return [...requiredIssues, ...unknownIssues, ...fieldIssues];
}

function checkField(path: string, schema: PayloadFieldSchema, value: unknown): readonly ContractViolation[] {
    if ("anyOf" in schema) {
        return schema.anyOf.some((branch) => checkField(path, branch, value).length === 0)
            ? []
            : violation(path, `${path} 不满足任一允许类型`);
    }
    switch (schema.type) {
        case "string":
            if (typeof value !== "string") return violation(path, `${path} 应为 string`);
            return schema.enum && !schema.enum.includes(value)
                ? violation(path, `${path} 应为 ${schema.enum.join(" | ")} 之一`)
                : [];
        case "number":
            return typeof value === "number" && Number.isFinite(value)
                ? []
                : violation(path, `${path} 应为有限 number`);
        case "boolean":
            return typeof value === "boolean" ? [] : violation(path, `${path} 应为 boolean`);
        case "array":
            return checkArray(path, schema, value);
        case "object":
            return checkObjectFields(path, schema, value);
        case "null":
            return value === null ? [] : violation(path, `${path} 应为 null`);
    }
}

/** 契约检查入口:空数组 = 通过。dispatch/query 最外层调用,先于命令构造 */
export function checkPayloadContract(contract: PayloadContract, payload: unknown): readonly ContractViolation[] {
    return checkObjectFields(CONTRACT_ROOT, contract, payload);
}

/** nullable 便捷构造:可选字段显式传 null 的合法形态 */
export function nullable(schema: PayloadFieldSchema): PayloadFieldSchema {
    return { anyOf: [schema, { type: "null" }] };
}

/** 三元数组建模量(position/rotation/scale 共用) */
export const VEC3_SCHEMA: PayloadFieldSchema = {
    type: "array",
    items: { type: "number" },
    minItems: 3,
    maxItems: 3,
};

/** Transform 三字段契约(object.place/object.move 等共用,Rule of Two) */
export const TRANSFORM_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: { position: VEC3_SCHEMA, rotation: VEC3_SCHEMA, scale: VEC3_SCHEMA },
    required: ["position", "rotation", "scale"],
};

/** 空 payload(Record<string, never>)命令的契约 */
export const EMPTY_PAYLOAD_CONTRACT: PayloadContract = { properties: {} };
