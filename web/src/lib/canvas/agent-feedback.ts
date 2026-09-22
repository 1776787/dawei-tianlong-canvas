export const AGENT_TOOL_LABELS: Record<string, string> = {
    update_task_plan: "更新任务计划",
    upsert_storyboard_shot: "编写分镜",
    prepare_storyboard_shot: "准备镜头媒体",
    inspect_image: "读取实际图像",
    generate_video: "生成视频",
    disconnect_nodes: "断开连线",
    validate_canvas: "验收画布",
    get_canvas_state: "检查画布",
    create_node: "创建节点",
    update_node: "更新节点",
    create_asset_plan: "规划资产",
    arrange_grid: "整理布局",
    connect_nodes: "连接节点",
    delete_nodes: "删除节点",
    focus_node: "定位节点",
    read_node_content: "读取节点",
    get_director_scene: "读取导演台",
    configure_director_shot: "编排导演台",
    generate_image: "生成图片",
    list_skills: "查看技能",
    read_skill: "读取技能",
    create_skill: "保存技能",
};

export function agentToolFeedback(name: string, output: Record<string, unknown>) {
    const label = AGENT_TOOL_LABELS[name] || name;
    if (output.status === "partial") return { text: `${label}部分完成：成功 ${output.succeeded}，失败 ${output.failed}。${String(output.error || "")}`, failed: true };
    if (output.status === "canceled" || output.canceled) return { text: `${label}已停止：${String(output.error || "已完成的成果保留")}`, failed: true };
    if (output.error || output.ok === false) return { text: `${label}失败：${String(output.error || "操作未完成")}`, failed: true };
    if (name === "generate_image" || name === "generate_video") return { text: `${label}完成：${output.succeeded} 项`, failed: false };
    if (name === "validate_canvas") return { text: output.passed ? "画布结构与状态检查通过" : `画布检查发现 ${Array.isArray(output.issues) ? output.issues.length : 1} 项待处理问题`, failed: output.passed !== true };
    if (name === "create_skill") return { text: "技能草稿已保存，待用户审核启用", failed: false };
    if (name === "create_asset_plan") return {
        text: `资产规划完成：${output.assetCount} 项独立资产，新增 ${Array.isArray(output.created) ? output.created.length : 0} 个节点，更新 ${Array.isArray(output.updated) ? output.updated.length : 0} 个节点`,
        failed: false,
    };
    if (name === "arrange_grid") return { text: `已整理 ${output.arranged} 个节点`, failed: false };
    if (name === "create_node" && output.created && typeof output.created === "object" && "title" in output.created) return { text: `已创建：${String(output.created.title)}`, failed: false };
    if (name === "get_canvas_state" && output.layout && typeof output.layout === "object" && "overlapCount" in output.layout) return {
        text: `画布检查完成：${Array.isArray(output.nodes) ? output.nodes.length : 0} 个节点，${output.layout.overlapCount} 处重叠`,
        failed: false,
    };
    return { text: `${label}完成`, failed: false };
}
