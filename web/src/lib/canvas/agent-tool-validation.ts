// Validate the same bounded JSON schema that is advertised to the model.
type Schema = {
    type?: string; required?: string[]; properties?: Record<string, Schema>; items?: Schema;
    enum?: unknown[]; minimum?: number; maximum?: number; minItems?: number; maxItems?: number;
};

export function validateAgentArguments(schema: Schema, value: unknown, path = "参数"): string | undefined {
    if (schema.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} 必须是对象`;
        const object = value as Record<string, unknown>;
        for (const key of schema.required || []) if (object[key] === undefined) return `${path}.${key} 不能为空`;
        for (const [key, child] of Object.entries(object)) {
            if (!schema.properties || !Object.hasOwn(schema.properties, key)) return `不支持的参数 ${path}.${key}`;
            const error = validateAgentArguments(schema.properties[key], child, `${path}.${key}`);
            if (error) return error;
        }
    } else if (schema.type === "array") {
        if (!Array.isArray(value)) return `${path} 必须是数组`;
        if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 500)) return `${path} 数量超出允许范围`;
        for (let index = 0; index < value.length; index++) {
            const error = schema.items && validateAgentArguments(schema.items, value[index], `${path}[${index}]`);
            if (error) return error;
        }
    } else if (schema.type === "number" || schema.type === "integer") {
        if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) return `${path} 必须是有效${schema.type === "integer" ? "整数" : "数字"}`;
        if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return `${path} 超出允许范围`;
    } else if (schema.type && typeof value !== schema.type) return `${path} 类型应为 ${schema.type}`;
    if (typeof value === "string" && value.length > 96000) return `${path} 超过 96,000 字符`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} 不在允许的选项内`;
    return undefined;
}
