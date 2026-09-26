import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioWaveform, Activity, History, ImagePlus, Moon, Music4, Palette,
  Pause, Play, SlidersHorizontal, Sparkles, Square, Sun, Thermometer,
  Trash2, Upload, Volume2, Waves, Gauge, Timer, Layers, Info, RotateCcw,
  Heart, SkipBack, SkipForward, ListMusic, Circle, Download, Plus, Check
} from 'lucide-react'
import { analyzeImage, mapToMusic, getScale, transposeScale } from './lib/imageAnalysis.js'
import { startGenerative, stopGenerative, setBpm, setWet, setVolumeDB, getAnalyser, startRecording, stopRecording } from './lib/audioEngine.js'

const HISTORY_KEY = 'smw-history-v1'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}

function Slider({ icon: Icon, label, value, min, max, step = 1, onChange, suffix = '' }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-zinc-400"><Icon size={13} /> {label}</span>
        <span className="font-mono text-zinc-200">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full" style={{ '--fill': `${pct}%` }} />
    </div>
  )
}

function StatBar({ label, value, icon: Icon, color }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-zinc-400">
        <span className="flex items-center gap-1"><Icon size={12} />{label}</span>
        <span className="font-mono text-zinc-200">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function Visualizer({ playing }) {
  const ref = useRef(null)
  useEffect(() => {
    let raf; let t = 0
    const draw = () => {
      const c = ref.current
      if (c) {
        const ctx = c.getContext('2d')
        const W = c.width, H = c.height
        ctx.clearRect(0, 0, W, H)
        const an = getAnalyser()
        let vals = null
        try { vals = an?.getValue() } catch {}
        const N = 48
        for (let i = 0; i < N; i++) {
          let h
          if (playing && vals && vals.length) {
            const v = vals[Math.floor(i / N * vals.length)]
            const db = typeof v === 'number' ? v : -60
            h = Math.max(3, ((db + 90) / 60) * H * 0.9)
          } else {
            t += 0.002
            h = Math.max(3, 10 + Math.sin(t * 8 + i * 0.55) * 3 + Math.sin(t * 3 + i * 0.2) * 4)
          }
          const x = (i / N) * W
          const g = ctx.createLinearGradient(0, H - h, 0, H)
          g.addColorStop(0, '#fbbf24'); g.addColorStop(1, '#7c3aed')
          ctx.fillStyle = g
          const bw = W / N - 3
          ctx.beginPath()
          ctx.roundRect(x, H - h, bw, h, 4)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [playing])
  return <canvas ref={ref} width={560} height={110} className="w-full h-[110px]" />
}

async function makeThumb(src) {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = 160; c.height = 100
      const ctx = c.getContext('2d')
      const ir = img.width / img.height, cr = 160 / 100
      let sw, sh, sx, sy
      if (ir > cr) { sh = img.height; sw = sh * cr; sx = (img.width - sw) / 2; sy = 0 }
      else { sw = img.width; sh = sw / cr; sx = 0; sy = (img.height - sh) / 2 }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 160, 100)
      res(c.toDataURL('image/jpeg', 0.6))
    }
    img.onerror = () => res(src)
    img.src = src
  })
}

export default function App() {
  const [tracks, setTracks] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [history, setHistory] = useState(loadHistory)
  const [volume, setVolume] = useState(80)
  const [bpm, setBpmState] = useState(72)
  const [wet, setWetState] = useState(55)
  const [octaveShift, setOctaveShift] = useState(0)
  const [scaleOverride, setScaleOverride] = useState('auto')
  const [padEnabled, setPadEnabled] = useState(true)
  const [autoplay, setAutoplay] = useState(false)
  const [isRec, setIsRec] = useState(false)
  const [recUrl, setRecUrl] = useState(null)
  const [recSecs, setRecSecs] = useState(0)
  const fileRef = useRef(null)
  const recTimer = useRef(null)

  const active = tracks[activeIdx] || null
  const analysis = active?.analysis || null

  const music = useMemo(() => {
    if (!active?.music) return null
    if (scaleOverride === 'auto') return active.music
    const s = getScale(scaleOverride)
    const root = active.music.root || 'C'
    return {
      ...active.music,
      scaleKey: scaleOverride, scaleName: s.name + ' (Manual)',
      notes: transposeScale(scaleOverride, root), mood: s.mood + ' • override manual',
    }
  }, [active, scaleOverride])

  const pushHistory = useCallback((fileName, thumb, a, m) => {
    const entry = {
      id: Date.now() + Math.random(), name: fileName, thumb,
      palette: a.palette, scaleName: m.scaleName, bpm: m.bpm,
      warmth: a.warmth, brightness: a.brightness,
    }
    setHistory((h) => {
      const next = [entry, ...h].slice(0, 12)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const handleFiles = useCallback(async (files) => {
    const imgs = [...(files || [])].filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    setAnalyzing(true)
    try {
      const startAt = tracks.length
      for (const file of imgs) {
        const url = URL.createObjectURL(file)
        try {
          const a = await analyzeImage(url)
          const m = mapToMusic(a)
          const thumb = await makeThumb(url)
          setTracks((t) => [...t, { id: Date.now() + Math.random(), src: url, thumb, fileName: file.name, analysis: a, music: m }])
          setBpmState((cur) => (tracks.length === 0 ? m.bpm : cur))
          pushHistory(file.name, thumb, a, m)
        } catch (e) { console.warn('gagal analisis', file.name, e) }
      }
      setActiveIdx(startAt)
    } finally { setAnalyzing(false) }
  }, [tracks.length, pushHistory])

  const playParams = useCallback((trk, mus) => ({
    notes: mus.notes, root: mus.root,
    octave: Math.min(6, Math.max(1, mus.octave + octaveShift)),
    bpm, attack: mus.attack, release: mus.release,
    warmth: trk.analysis.warmth, brightness: trk.analysis.brightness,
    saturation: trk.analysis.saturation, contrast: trk.analysis.contrast,
    hue: trk.analysis.hue, scaleKey: mus.scaleKey, padEnabled,
    cutoff: mus.cutoff, reverbDecay: mus.reverbDecay,
    sparkleDensity: mus.sparkleDensity, timbre: mus.timbre, swing: mus.swing,
  }), [bpm, octaveShift, padEnabled])

  const playTrack = useCallback(async (idx) => {
    const trk = tracks[idx]
    if (!trk) return
    setActiveIdx(idx)
    // hitung musik efektif untuk track itu (dengan override, root dipertahankan)
    let mus = trk.music
    if (scaleOverride !== 'auto') {
      const s = getScale(scaleOverride)
      mus = { ...mus, scaleKey: scaleOverride, scaleName: s.name, notes: transposeScale(scaleOverride, trk.music.root || 'C') }
    }
    if (playing || true) {
      // restart agar crossfade mulus antar foto
      stopGenerative(false)
      await startGenerative({
        notes: mus.notes, root: mus.root,
        octave: Math.min(6, Math.max(1, mus.octave + octaveShift)),
        bpm, attack: mus.attack, release: mus.release,
        warmth: trk.analysis.warmth, brightness: trk.analysis.brightness,
        saturation: trk.analysis.saturation, contrast: trk.analysis.contrast,
        hue: trk.analysis.hue, scaleKey: mus.scaleKey, padEnabled,
        cutoff: mus.cutoff, reverbDecay: mus.reverbDecay,
        sparkleDensity: mus.sparkleDensity, timbre: mus.timbre, swing: mus.swing,
      })
      setPlaying(true)
    }
  }, [tracks, playing, scaleOverride, octaveShift, bpm, padEnabled])

  const togglePlay = async () => {
    if (!music || !active) return
    if (playing) { stopGenerative(); setPlaying(false); return }
    await startGenerative(playParams(active, music))
    setPlaying(true)
  }
  const handleStop = () => { stopGenerative(); setPlaying(false) }
  const nextTrack = useCallback(() => {
    if (!tracks.length) return
    playTrack((activeIdx + 1) % tracks.length)
  }, [tracks.length, activeIdx, playTrack])
  const prevTrack = useCallback(() => {
    if (!tracks.length) return
    playTrack((activeIdx - 1 + tracks.length) % tracks.length)
  }, [tracks.length, activeIdx, playTrack])

  // live controls
  useEffect(() => { if (playing) setBpm(bpm) }, [bpm, playing])
  useEffect(() => { if (playing) setWet(wet / 100) }, [wet, playing])
  useEffect(() => { setVolumeDB(volume <= 0 ? -60 : -30 + (volume / 100) * 30) }, [volume])
  useEffect(() => () => { stopGenerative(); clearInterval(recTimer.current) }, [])

  // autoplay album 25 detik
  useEffect(() => {
    if (!autoplay || !playing || tracks.length < 2) return
    const id = setInterval(() => nextTrack(), 25000)
    return () => clearInterval(id)
  }, [autoplay, playing, tracks.length, nextTrack])

  // ganti pad / oktaf / skala saat bunyi → restart mulus
  const restartLive = useCallback(async () => {
    if (!playing || !active || !music) return
    await startGenerative(playParams(active, music))
  }, [playing, active, music, playParams])
  useEffect(() => { restartLive() }, [padEnabled, scaleOverride, octaveShift])

  const toggleRec = async () => {
    if (isRec) {
      const out = await stopRecording()
      clearInterval(recTimer.current)
      setIsRec(false)
      if (out?.url) setRecUrl(out.url)
      return
    }
    if (!playing) await togglePlay()
    setRecUrl(null); setRecSecs(0)
    await startRecording()
    setIsRec(true)
    recTimer.current = setInterval(() => setRecSecs((s) => s + 1), 1000)
  }

  const reloadHistory = async (h) => {
    setAnalyzing(true)
    try {
      const a = await analyzeImage(h.thumb)
      const m = mapToMusic(a)
      const id = Date.now() + Math.random()
      setTracks((t) => [...t, { id, src: h.thumb, thumb: h.thumb, fileName: h.name, analysis: a, music: m }])
      setActiveIdx(tracks.length)
    } finally { setAnalyzing(false) }
  }

  const warm = analysis?.isWarm
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] blur-[120px] opacity-30 transition-colors duration-1000"
          style={{ background: analysis ? `linear-gradient(90deg, ${analysis.palette[0] || '#f59e0b'}, ${analysis.palette[2] || '#7c3aed'})` : 'linear-gradient(90deg,#f59e0b,#7c3aed)' }}
        />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] bg-violet-900/30 blur-[100px]" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
              <Waves size={22} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Sonic Memory Weaver</h1>
              <p className="text-xs text-zinc-400">Foto → warna → musik ambient • 100% client-side</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {isRec && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-300">
                <Circle size={10} className="fill-red-400 text-red-400 animate-pulse" /> REC {fmt(recSecs)}
              </span>
            )}
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${playing ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
              <span className={`w-2 h-2 rounded-full ${playing ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
              {playing ? 'Memutar' : 'Berhenti'}
            </span>
          </div>
        </header>

        <div className="grid lg:grid-cols-5 gap-5">
          <section className="lg:col-span-3 space-y-5">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              className={`cursor-pointer rounded-3xl border-2 border-dashed transition-all overflow-hidden ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-zinc-700 bg-zinc-900/60 hover:border-zinc-500'}`}
            >
              {!active ? (
                <div className="py-14 px-6 text-center space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center animate-bounce">
                    <ImagePlus size={26} className="text-amber-400" />
                  </div>
                  <p className="font-semibold">Seret & letakkan 1 / banyak foto di sini</p>
                  <p className="text-xs text-zinc-400">klik untuk memilih • bisa multi-select untuk jadi album • JPG/PNG/WEBP • lokal</p>
                  <span className="inline-flex items-center gap-2 text-xs bg-white text-black font-semibold px-4 py-2 rounded-full mt-2">
                    <Upload size={14} /> Pilih Foto / Album
                  </span>
                </div>
              ) : (
                <div className="relative group">
                  <img src={active.src} alt="upload" className="w-full max-h-[380px] object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                    <span className="text-xs bg-black/60 backdrop-blur px-3 py-1.5 rounded-full truncate max-w-[55%]">{activeIdx + 1}/{tracks.length} • {active.fileName}</span>
                    <div className="flex gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); prevTrack() }} className="w-8 h-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-black"><SkipBack size={14} /></button>
                      <button onClick={(e) => { e.stopPropagation(); nextTrack() }} className="w-8 h-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-black"><SkipForward size={14} /></button>
                      <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }} className="text-xs flex items-center gap-1.5 bg-white text-black font-semibold px-3 py-1.5 rounded-full hover:bg-amber-300">
                        <Plus size={13} /> Tambah
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </div>

            {/* Playlist album */}
            {tracks.length > 1 && (
              <div className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-4 backdrop-blur space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><ListMusic size={15} className="text-amber-400" /> Album Generatif ({tracks.length})</h2>
                  <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer">
                    <button onClick={() => setAutoplay(!autoplay)} className={`w-9 h-5 rounded-full relative transition ${autoplay ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${autoplay ? 'left-4.5 left-[18px]' : 'left-0.5'}`} />
                    </button>
                    Autoplay 25 dtk
                  </label>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {tracks.map((t, i) => (
                    <button key={t.id} onClick={() => playTrack(i)}
                      className={`shrink-0 w-28 rounded-2xl overflow-hidden border transition ${i === activeIdx ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-zinc-800 hover:border-zinc-600'}`}>
                      <img src={t.thumb} className="w-full h-16 object-cover" alt={t.fileName} />
                      <p className="text-[10px] truncate p-1.5 bg-zinc-950">{i + 1}. {t.fileName}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 space-y-4 backdrop-blur">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Palette size={15} className="text-amber-400" /> Ekstraksi Warna & Cahaya</h2>
                {analyzing && <span className="text-xs text-amber-300 flex items-center gap-1.5"><Sparkles size={13} className="animate-spin" /> Menganalisis…</span>}
              </div>
              {!analysis ? (
                <p className="text-xs text-zinc-500 leading-relaxed flex gap-2"><Info size={14} className="shrink-0 mt-0.5" /> Unggah foto untuk membaca RGBA via &lt;canvas&gt;: brightness, saturasi, suhu, kontras + 6 palet dominan.</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    {analysis.palette.map((hex) => (
                      <div key={hex} className="flex-1 group">
                        <div className="h-12 rounded-xl border border-white/10 transition-transform group-hover:scale-105" style={{ background: hex }} />
                        <p className="text-[10px] font-mono text-zinc-400 mt-1 text-center">{hex}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
                    <StatBar label="Kecerahan" value={analysis.brightness} icon={Sun} color="bg-gradient-to-r from-amber-300 to-yellow-500" />
                    <StatBar label="Saturasi" value={analysis.saturation} icon={Activity} color="bg-gradient-to-r from-pink-400 to-rose-500" />
                    <StatBar label="Kehangatan" value={analysis.warmth} icon={Thermometer} color="bg-gradient-to-r from-orange-400 to-red-500" />
                    <StatBar label="Kontras" value={analysis.contrast} icon={Gauge} color="bg-gradient-to-r from-violet-400 to-indigo-500" />
                  </div>
                </>
              )}
            </div>

            <div className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 space-y-3 backdrop-blur">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><History size={15} className="text-violet-400" /> Memori Tersimpan <span className="text-zinc-500 font-normal">• LocalStorage</span></h2>
                {history.length > 0 && (
                  <button onClick={() => { setHistory([]); localStorage.removeItem(HISTORY_KEY) }} className="text-[11px] flex items-center gap-1 text-zinc-400 hover:text-red-400"><Trash2 size={12} /> Hapus</button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-zinc-500">Belum ada riwayat. Setiap foto yang dianalisis tersimpan otomatis.</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {history.map((h) => (
                    <button key={h.id} onClick={() => reloadHistory(h)} className="shrink-0 w-36 text-left rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 hover:border-amber-400/60 transition group">
                      <img src={h.thumb} className="w-full h-20 object-cover group-hover:scale-105 transition" alt={h.name} />
                      <div className="p-2">
                        <p className="text-[11px] font-medium truncate">{h.name}</p>
                        <p className="text-[10px] text-zinc-500">{h.scaleName} • {h.bpm} BPM</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="lg:col-span-2 space-y-5">
            <div className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-5 space-y-4 shadow-2xl shadow-black/50 sticky top-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Music4 size={15} className="text-emerald-400" /> Generative Player</h2>
                {music && <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-300">{music.rootFreqHint} • {music.bpm} BPM</span>}
              </div>

              <div className="rounded-2xl bg-black/60 border border-white/5 p-2 overflow-hidden">
                <Visualizer playing={playing} />
              </div>

              {!music ? (
                <div className="text-center py-6 space-y-2">
                  <AudioWaveform size={28} className="mx-auto text-zinc-600" />
                  <p className="text-xs text-zinc-500">Musik muncul setelah foto dianalisis.</p>
                </div>
              ) : (
                <>
                  <div className={`rounded-2xl p-4 border ${warm ? 'border-orange-400/30 bg-orange-400/5' : 'border-sky-400/30 bg-sky-400/5'}`}>
                    <p className="text-[11px] uppercase tracking-widest opacity-70 flex items-center gap-1.5">
                      {warm ? <Sun size={12} /> : <Moon size={12} />} Tangga nada terdeteksi
                    </p>
                    <p className="text-xl font-bold mt-0.5">{music.scaleName} <span className="text-amber-400">• {music.root}</span></p>
                    <p className="text-xs text-zinc-400">{music.mood} • {music.timbre} • cutoff {(music.cutoff / 1000).toFixed(1)}kHz</p>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {music.notes.map((n) => (
                        <span key={n} className="text-[11px] font-mono px-2 py-1 rounded-lg bg-black/50 border border-white/10">{n}{Math.min(6, Math.max(1, music.octave + octaveShift))}</span>
                      ))}
                    </div>
                    {/* override skala */}
                    <div className="flex gap-1 mt-3 text-[11px]">
                      {['auto', 'major', 'minor', 'dorian'].map((k) => (
                        <button key={k} onClick={() => setScaleOverride(k)}
                          className={`px-2.5 py-1 rounded-full border capitalize transition ${scaleOverride === k ? 'bg-amber-400 text-black border-amber-400 font-semibold' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>
                          {k === 'auto' ? '✨ Auto' : k}
                        </button>
                      ))}
                    </div>
                    {/* pad toggle */}
                    <button onClick={() => setPadEnabled(!padEnabled)}
                      className="mt-2.5 flex items-center gap-2 text-[11px] text-zinc-300">
                      <span className={`w-8 h-4.5 h-[18px] rounded-full relative transition ${padEnabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
                        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${padEnabled ? 'left-[16px]' : 'left-[2px]'}`} />
                      </span>
                      {padEnabled ? <span className="flex items-center gap-1"><Check size={11} /> Chord Pad aktif (I–V–vi–IV)</span> : 'Chord Pad mati (melodi saja)'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={togglePlay}
                      className={`flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-3 rounded-2xl transition active:scale-95 ${playing ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-white text-black hover:bg-amber-300'}`}>
                      {playing ? <><Pause size={17} /> Pause Loop</> : <><Play size={17} /> Mainkan Musik Foto</>}
                    </button>
                    <button onClick={handleStop} title="Stop" className="w-12 h-12 rounded-2xl border border-zinc-700 bg-zinc-900 flex items-center justify-center hover:border-red-400 hover:text-red-400 transition">
                      <Square size={16} />
                    </button>
                  </div>

                  {/* record */}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                        <Circle size={11} className={isRec ? 'fill-red-500 text-red-500 animate-pulse' : 'text-zinc-500'} />
                        {isRec ? `Merekam… ${fmt(recSecs)}` : 'Rekam loop jadi audio'}
                      </p>
                      <button onClick={toggleRec}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition ${isRec ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'}`}>
                        {isRec ? 'Stop & Simpan' : '● Record'}
                      </button>
                    </div>
                    {recUrl && (
                      <div className="flex items-center gap-2 text-[11px]">
                        <audio src={recUrl} controls className="w-full h-8" />
                        <a href={recUrl} download={`sonic-memory-${Date.now()}.webm`}
                          className="shrink-0 w-9 h-9 rounded-xl bg-emerald-500 text-black flex items-center justify-center hover:bg-emerald-400" title="Download">
                          <Download size={15} />
                        </a>
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-500">Rekaman diambil langsung dari Web Audio (MediaStreamDestination), tanpa server.</p>
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5"><SlidersHorizontal size={12} /> MIXER</p>
                    <Slider icon={Volume2} label="Volume" value={volume} min={0} max={100} onChange={setVolume} suffix="%" />
                    <Slider icon={Gauge} label="Tempo (BPM)" value={bpm} min={50} max={120} onChange={setBpmState} />
                    <Slider icon={Waves} label="Reverb / Ruang" value={wet} min={0} max={100} onChange={setWetState} suffix="%" />
                    <Slider icon={Layers} label="Geser Oktaf" value={octaveShift} min={-2} max={2} onChange={setOctaveShift} />
                  </div>
                </>
              )}

              <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-3.5 text-[11px] text-zinc-400 leading-relaxed space-y-1.5">
                <p className="font-semibold text-zinc-300 flex items-center gap-1.5"><Heart size={11} className="text-pink-400" /> Logika pemetaan</p>
                <p>• <b className="text-zinc-200">Hangat</b> → Mayor • <b className="text-zinc-200">Dingin</b> → Minor / Dorian</p>
                <p>• <b className="text-zinc-200">Terang</b> → oktaf tinggi • <b className="text-zinc-200">Gelap</b> → bass rendah</p>
                <p>• <b className="text-zinc-200">Pad</b> mainkan chord I–V–vi–IV tiap 1 bar • kontras → tempo</p>
              </div>
            </div>
          </section>
        </div>

        <footer className="text-center text-[11px] text-zinc-600 pb-4 flex items-center justify-center gap-1.5">
          <Timer size={11} /> Foto {tracks.length} • React + Tone.js + Lucide • Tanpa server.
          {tracks.length > 0 && (
            <button onClick={() => { handleStop(); setTracks([]) }} className="ml-2 flex items-center gap-1 hover:text-red-400"><RotateCcw size={11} /> Reset album</button>
          )}
        </footer>
      </div>
    </div>
  )
}
