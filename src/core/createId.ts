/**
 * UUIDv4 生成器。`crypto.randomUUID` 仅安全上下文可用;部署在 http 非 localhost
 * 的宿主(如局域网 playground)里它不存在,统一走本函数:getRandomValues 优先,
 * Math.random 兜底(仅标识用途,无安全语义)。
 */
const UUID_BYTE_LENGTH = 16;
const VERSION_BYTE_INDEX = 6;
const VERSION_FLAG = 0x40;
const VARIANT_BYTE_INDEX = 8;
const VARIANT_FLAG = 0x80;
const NIBBLE_MASK = 0x0f;
const VARIANT_MASK = 0x3f;
const BYTE_RADIX = 16;
const BYTE_MAX_EXCLUSIVE = 256;
const HEX_PAD = 2;
const HEX_SEGMENT_LENGTHS = [8, 4, 4, 4, 12] as const;

export function createId(): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    const bytes = new Uint8Array(UUID_BYTE_LENGTH);
    if (typeof cryptoApi?.getRandomValues === "function") {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (const index of bytes.keys()) bytes[index] = Math.floor(Math.random() * BYTE_MAX_EXCLUSIVE);
    }
    bytes[VERSION_BYTE_INDEX] = ((bytes[VERSION_BYTE_INDEX] ?? 0) & NIBBLE_MASK) | VERSION_FLAG;
    bytes[VARIANT_BYTE_INDEX] = ((bytes[VARIANT_BYTE_INDEX] ?? 0) & VARIANT_MASK) | VARIANT_FLAG;
    const hex = Array.from(bytes, (byte) => byte.toString(BYTE_RADIX).padStart(HEX_PAD, "0")).join("");
    const segments: string[] = [];
    let offset = 0;
    for (const length of HEX_SEGMENT_LENGTHS) {
        segments.push(hex.slice(offset, offset + length));
        offset += length;
    }
    return segments.join("-");
}
