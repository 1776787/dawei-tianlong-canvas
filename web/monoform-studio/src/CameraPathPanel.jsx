import { ArrowDown, ArrowUp, Camera, Play, Plus, Trash2, Video } from 'lucide-react'

export function CameraPathPanel({ keys, camera, fps, totalFrames, busy, onChange, onSeek, onPreview, onRecord }) {
  const update = (index, patch) => onChange(keys.map((key, i) => i === index ? { ...key, ...patch } : key).sort((a, b) => a.frame - b.frame))
  const add = () => {
    const frame = keys.length ? Math.min(totalFrames, keys[keys.length - 1].frame + fps * 2) : 0
    if (keys.some(key => key.frame === frame)) return
    onChange([...keys, { ...camera, position: [...camera.position], rotation: [...camera.rotation], frame, interpolation: 'smooth' }])
  }
  const swap = (index, direction) => {
    const next = [...keys]
    const other = index + direction
    next[index] = { ...keys[other], frame: keys[index].frame }
    next[other] = { ...keys[index], frame: keys[other].frame }
    onChange(next)
  }
  return <section className="camera-path-panel"><h3>摄像机路径</h3>
    <div className="path-actions"><button onClick={add} disabled={busy || keys.some(key => key.frame === totalFrames)} title="添加当前机位为路径点"><Plus size={14} />路径点</button><button onClick={onPreview} disabled={busy || keys.length < 2}><Play size={14} />预览路径</button><button onClick={onRecord} disabled={busy || keys.length < 2}><Video size={14} />按路径录制</button></div>
    <ol>{keys.map((key, index) => <li key={key.frame}>
      <button title={`跳到路径点 ${index + 1}`} onClick={() => onSeek(key.frame)} disabled={busy}>{index + 1}</button>
      <label>秒<input aria-label={`路径点${index + 1}时间`} type="number" min={0} max={totalFrames / fps} step={1 / fps} value={Number((key.frame / fps).toFixed(3))} disabled={busy} onChange={event => { const frame = Math.round(Number(event.target.value) * fps); if (Number.isFinite(frame) && frame >= 0 && frame <= totalFrames && !keys.some((item, i) => i !== index && item.frame === frame)) update(index, { frame }) }} /></label>
      <select aria-label={`路径点${index + 1}插值`} value={key.interpolation || 'smooth'} disabled={busy} onChange={event => update(index, { interpolation: event.target.value })}><option value="smooth">平滑</option><option value="linear">匀速</option><option value="hold">切镜</option></select>
      <button title="用当前机位替换" disabled={busy} onClick={() => update(index, { ...camera, position: [...camera.position], rotation: [...camera.rotation] })}><Camera size={14} /></button>
      <button title="上移机位" disabled={busy || index === 0} onClick={() => swap(index, -1)}><ArrowUp size={14} /></button><button title="下移机位" disabled={busy || index === keys.length - 1} onClick={() => swap(index, 1)}><ArrowDown size={14} /></button><button title="删除路径点" disabled={busy} onClick={() => onChange(keys.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
    </li>)}</ol>
  </section>
}
