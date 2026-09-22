type Data = Record<string, any>;
export const DIRECTOR_OBJECT_TYPES = ['person', 'box', 'sphere', 'cylinder', 'plane', 'arch', 'stairs', 'table', 'chair', 'sofa', 'door', 'window', 'tree', 'vehicle', 'roof', 'plant', 'building', 'road'];
const vector = (value: unknown, name: string): number[] => {
    if (!Array.isArray(value) || value.length !== 3 || value.some(x => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1000)) throw new Error(`${name} 必须是三个有限坐标，范围 -1000 到 1000`);
    return [...value];
};
const camera = (value: Data) => {
    const position = vector(value.position, 'camera.position');
    const target = vector(value.target, 'camera.target');
    const [dx, dy, dz] = target.map((x, i) => x - position[i]);
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.001) throw new Error('相机位置与注视点不能相同');
    const focalLength = value.focalLength ?? 50;
    if (!Number.isFinite(focalLength) || focalLength < 18 || focalLength > 120) throw new Error('焦距范围为 18–120 mm');
    return { position, target, rotation: [Math.asin(dy / distance), Math.atan2(-dx, -dz), 0], rotationOrder: 'YXZ', focalLength, aspectRatio: ['16:9', '9:16', '4:3', '1:1'].includes(value.aspectRatio) ? value.aspectRatio : '16:9' };
};
export function buildDirectorShot(project: Data | null, args: Data) {
    const id = String(args.shotId || '').trim();
    if (!id) throw new Error('缺少 shotId');
    const oldShots: Data[] = Array.isArray(project?.shots) ? project!.shots : [];
    const old = oldShots.find((shot: Data) => shot.id === id);
    if (!old && oldShots.length >= 30) throw new Error('导演台最多 30 个镜头');
    if (args.objects !== undefined && (!Array.isArray(args.objects) || args.objects.length > 100)) throw new Error('objects 必须是最多 100 项的数组');
    const durationSeconds = args.durationSeconds ?? old?.durationSeconds ?? 5;
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) throw new Error('镜头时长范围为 1–60 整秒');
    const fps = old?.fps || ([24, 25, 30].includes(project?.settings?.fps) ? project!.settings.fps : 24);
    const oldObjects: Data[] = Array.isArray(old?.objects) ? old.objects : [];
    if (args.removeObjectIds !== undefined && (!Array.isArray(args.removeObjectIds) || args.removeObjectIds.some((value: unknown) => typeof value !== 'string'))) throw new Error('removeObjectIds 必须是 ID 数组');
    const removed = new Set<string>(args.removeObjectIds || []);
    if ([...removed].some(id => !oldObjects.some(object => object.id === id))) throw new Error('要移除的物体不存在');
    const ids = new Set<string>();
    const patches = (args.objects || []).map((o: Data) => {
        if (!o || typeof o.id !== 'string' || !o.id || ids.has(o.id)) throw new Error('物体 ID 必须唯一且非空');
        ids.add(o.id);
        if (removed.has(o.id)) throw new Error('不能同时更新和移除同一物体');
        const previous = oldObjects.find(object => object.id === o.id);
        const type = o.type ?? previous?.type;
        if (!DIRECTOR_OBJECT_TYPES.includes(type) && (!previous || o.type !== undefined)) throw new Error('新物体需要有效的 type');
        if (previous && o.type && o.type !== previous.type) throw new Error('物体类型不能原地替换，请用新的稳定 ID');
        const scale = vector(o.scale ?? previous?.scale ?? [1, 1, 1], 'scale');
        if (scale.some(x => x <= 0)) throw new Error('缩放必须大于零');
        return { ...previous, id: o.id, name: String(o.name ?? previous?.name ?? o.id).slice(0, 80), type,
            position: vector(o.position ?? previous?.position, 'position'), rotation: vector(o.rotation ?? previous?.rotation ?? [0, 0, 0], 'rotation'), scale,
            color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : previous?.color ?? '#dadcde',
            bodyType: previous?.bodyType ?? 'standard', pose: String(o.pose ?? previous?.pose ?? 'idle'),
            poseTime: previous?.poseTime ?? 0, continuousMotion: typeof o.continuousMotion === 'boolean' ? o.continuousMotion : previous?.continuousMotion ?? false };
    });
    const objects: Data[] = args.replaceObjects === true ? patches : [
        ...oldObjects.filter(object => !removed.has(object.id)).map(object => patches.find((patch: Data) => patch.id === object.id) || object),
        ...patches.filter((patch: Data) => !oldObjects.some(object => object.id === patch.id)),
    ];
    if (objects.length > 100) throw new Error('一个镜头最多 100 个物体');
    const shotCamera = args.camera ? camera({ ...old?.camera, ...args.camera }) : old?.camera;
    if (!shotCamera) throw new Error('创建镜头时必须提供相机位置和注视点');
    if (args.path !== undefined && (!Array.isArray(args.path) || args.path.length > 120)) throw new Error('路径最多 120 个点');
    const frames = new Set<number>();
    const keyframes = args.path === undefined ? old?.keyframes || [] : args.path.map((point: Data) => {
        if (!Number.isFinite(point.seconds) || point.seconds < 0 || point.seconds > durationSeconds) throw new Error('路径时间超出镜头时长');
        const frame = Math.round(point.seconds * fps);
        if (frames.has(frame)) throw new Error('路径时间重复');
        frames.add(frame);
        return { ...camera({ focalLength: shotCamera.focalLength, ...point, aspectRatio: shotCamera.aspectRatio }), frame, interpolation: ['smooth', 'linear', 'hold'].includes(point.interpolation) ? point.interpolation : 'smooth' };
    }).sort((a: Data, b: Data) => a.frame - b.frame);
    const objectKeyframes: Record<string, Data[]> = Object.assign(Object.create(null),
        Object.fromEntries(Object.entries(old?.objectKeyframes || {}).filter(([objectId]) => objects.some(object => object.id === objectId))));
    if (args.motions !== undefined && (!Array.isArray(args.motions) || args.motions.length > 100)) throw new Error('motions 最多 100 条物体轨道');
    const motionIds = new Set<string>();
    for (const motion of args.motions || []) {
        const object = objects.find(object => object.id === motion.id);
        if (!object || motionIds.has(motion.id)) throw new Error('动画轨道需要唯一且存在的物体 ID');
        motionIds.add(motion.id);
        if (!Array.isArray(motion.points) || motion.points.length > 120) throw new Error('每条动画轨道最多 120 个点');
        const frameIds = new Set<number>();
        objectKeyframes[motion.id] = motion.points.map((point: Data) => {
            if (!Number.isFinite(point.seconds) || point.seconds < 0 || point.seconds > durationSeconds) throw new Error('动画时间超出镜头时长');
            const frame = Math.round(point.seconds * fps);
            if (frameIds.has(frame)) throw new Error('动画时间重复');
            frameIds.add(frame);
            return { frame, position: vector(point.position ?? object.position, 'motion.position'),
                rotation: vector(point.rotation ?? object.rotation, 'motion.rotation'), scale: object.scale,
                pose: String(point.pose ?? object.pose), poseTime: 0,
                continuousMotion: point.continuousMotion ?? object.continuousMotion,
                interpolation: ['smooth', 'linear', 'hold'].includes(point.interpolation) ? point.interpolation : 'smooth' };
        }).sort((a: Data, b: Data) => a.frame - b.frame);
    }
    const allFrames = [...keyframes, ...Object.values(objectKeyframes).flat()];
    if (allFrames.some(point => point.frame > durationSeconds * fps)) throw new Error('缩短时长会截断现有动画，请先调整超出时长的路径或轨道');
    const shot = { ...old, id, name: String(args.name ?? old?.name ?? id).slice(0, 30), fps, durationSeconds,
        loopPlayback: old?.loopPlayback ?? false, objects, camera: shotCamera, keyframes, objectKeyframes };
    const shots = old ? oldShots.map((item: Data) => item.id === id ? shot : item) : [...oldShots, shot];
    return { ...project, version: 16, settings: { ...project?.settings, name: project?.settings?.name || '分镜预演', fps, durationSeconds, loopPlayback: shot.loopPlayback },
        shots, activeShotId: id, objects, camera: shotCamera, keyframes, objectKeyframes,
        ...(old?.lighting ? { lighting: old.lighting } : {}), ...(old?.reference ? { reference: old.reference } : {}) };
}
export async function directorProjectRequest(nodeId: string, project?: Data, signal?: AbortSignal): Promise<Data | null> {
    if (signal?.aborted) throw new DOMException('操作已停止', 'AbortError');
    const key = `monoform-project-${nodeId}`;
    const iframe = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-director-node]')].find(frame => frame.dataset.directorNode === nodeId);
    if (!iframe?.contentWindow) {
        if (project) { localStorage.setItem(key, JSON.stringify(project)); return project; }
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : null;
    }
    const source = iframe.contentWindow;
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(new DOMException(project ? '已停止等待；已发送的导演台修改可能已生效，请重新读取场景' : '操作已停止', 'AbortError')); };
        const receive = (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== source || event.data?.source !== 'monoform-director' || event.data.requestId !== requestId) return;
            cleanup();
            if (event.data.error) reject(new Error(event.data.error));
            else {
                try {
                    if (project) localStorage.setItem(key, JSON.stringify(event.data.project));
                    resolve(event.data.project);
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            }
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error('导演台尚未就绪，请稍后重试')); }, 5000);
        window.addEventListener('message', receive);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        source.postMessage({ source: 'canvas-director', requestId, type: project ? 'set-project' : 'get-project', project }, location.origin);
    });
}
