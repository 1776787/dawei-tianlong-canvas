import type { ResponseFunctionTool } from "@/services/api/image";
import { DIRECTOR_OBJECT_TYPES } from "./director-agent";

const vector = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
const camera = {
    type: "object", properties: {
        position: vector, target: vector,
        focalLength: { type: "number", minimum: 18, maximum: 120 },
        aspectRatio: { type: "string", enum: ["16:9", "9:16", "4:3", "1:1"] },
    }, required: ["position", "target"],
};
const timing = {
    seconds: { type: "number", minimum: 0, maximum: 60 },
    position: vector,
    interpolation: { type: "string", enum: ["smooth", "linear", "hold"] },
};

export const DIRECTOR_TOOLS: ResponseFunctionTool[] = [
    { type: "function", function: {
        name: "get_director_scene", description: "读取导演台最新完整场景、稳定镜头 ID、人物、相机和动画轨道。编辑前读取。",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    } },
    { type: "function", function: {
        name: "configure_director_shot",
        description: "按稳定 shotId 增量创建或编辑导演台镜头。省略字段保持原值；objects 按物体 ID 合并，保留未提及物体与动画。新镜头需要 camera，新物体需要 type/position。path 替换相机路径，motions 只替换指定物体轨道；空数组清空指定路径。移除物体或 replaceObjects 需用户确认。单位米，Y 向上，人物朝 +Z，旋转为弧度。只预演编排，不录制。",
        parameters: { type: "object", properties: {
            id: { type: "string" }, shotId: { type: "string" }, name: { type: "string" },
            durationSeconds: { type: "integer", minimum: 1, maximum: 60 },
            replaceObjects: { type: "boolean" },
            removeObjectIds: { type: "array", items: { type: "string" }, maxItems: 100 },
            objects: { type: "array", maxItems: 100, items: { type: "object", properties: {
                id: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: DIRECTOR_OBJECT_TYPES },
                position: vector, rotation: vector, scale: vector, color: { type: "string" },
                pose: { type: "string", description: "使用场景中已有或导演台支持的动作名称" }, continuousMotion: { type: "boolean" },
            }, required: ["id"] } },
            camera,
            path: { type: "array", maxItems: 120, items: { type: "object", properties: {
                ...timing, target: vector, focalLength: { type: "number", minimum: 18, maximum: 120 },
            }, required: ["seconds", "position", "target"] } },
            motions: { type: "array", maxItems: 100, items: { type: "object", properties: {
                id: { type: "string" },
                points: { type: "array", maxItems: 120, items: { type: "object", properties: {
                    ...timing, rotation: vector, pose: { type: "string" }, continuousMotion: { type: "boolean" },
                }, required: ["seconds"] } },
            }, required: ["id", "points"] } },
        }, required: ["id", "shotId"] },
    } },
];
