import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioWaveform, Activity, History, ImagePlus, Moon, Music4, Palette,
  Pause, Play, SlidersHorizontal, Sparkles, Square, Sun, Thermometer,
  Trash2, Upload, Volume2, Waves, Gauge, Timer, Layers, Info, RotateCcw, Heart
} from 'lucide-react'
import { analyzeImage, mapToMusic } from './lib/imageAnalysis.js'
import { startGenerative, stopGenerative, setBpm, setWet, setVolumeDB, getAnalyser } from './lib/audioEngine.js'

const HISTORY_KEY = 'smw-history-v1'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}

function Slider({ icon: Icon, label, value, min, max, step = 1, onChange, suffix = '', accent = true }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-zinc-400">
          <Icon size={13} /> {label}
        </span>
        <span className="font-mono text-zinc-200">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full" style={{ '--fill': `${pct}%` }}
      />
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
            h = 4 + Math.sin(t * 8 + i * 0.55) * 3 + Math.sin(t * 3 + i * 0.2) * 4
            h = Math.max(3, h + 6)
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

export default function App() {
  const [imgSrc, setImgSrc] = useState(null)
  const [fileName, setFileName] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [music, setMusic] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [history, setHistory] = useState(loadHistory)
  const [volume, setVolume] = useState(80)
  const [bpm, setBpmState] = useState(72)
  const [wet, setWetState] = useState(55)
  const [octaveShift, setOctaveShift] = useState(0)
  const fileRef = useRef(null)

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setImgSrc(url); setFileName(file.name)
    setAnalyzing(true)
    try {
      const a = await analyzeImage(url)
      const m = mapToMusic(a)
      setAnalysis(a); setMusic(m); setBpmState(m.bpm)
      // simpan riwayat (thumbnail compress via canvas agar localStorage ringan)
      const thumb = await makeThumb(url)
      const entry = {
        id: Date.now(), name: file.name, thumb,
        palette: a.palette, scaleName: m.scaleName, bpm: m.bpm,
        warmth: a.warmth, brightness: a.brightness,
      }
      setHistory((h) => {
        const next = [entry, ...h].slice(0, 12)
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    } finally { setAnalyzing(false) }
  }, [])

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

  const togglePlay = async () => {
    if (!music || !analysis) return
    if (playing) { stopGenerative(); setPlaying(false); return }
    await startGenerative({
      notes: music.notes,
      octave: Math.min(6, Math.max(1, music.octave + octaveShift)),
      bpm, attack: music.attack, release: music.release,
      warmth: analysis.warmth, brightness: analysis.brightness,
    })
    setPlaying(true)
  }
  const handleStop = () => { stopGenerative(); setPlaying(false) }

  useEffect(() => { if (playing) setBpm(bpm) }, [bpm, playing])
  useEffect(() => { if (playing) setWet(wet / 100) }, [wet, playing])
  useEffect(() => { setVolumeDB(volume <= 0 ? -60 : -30 + (volume / 100) * 30) }, [volume])
  useEffect(() => () => stopGenerative(), [])

  const reloadHistory = async (h) => {
    // history hanya simpan thumb — analisis ulang dari thumb agar musik konsisten
    setImgSrc(h.thumb); setFileName(h.name); setAnalyzing(true)
    try {
      const a = await analyzeImage(h.thumb)
      setAnalysis(a); setMusic(mapToMusic(a))
    } finally { setAnalyzing(false) }
  }

  const clearHistory = () => {
    setHistory([]); localStorage.removeItem(HISTORY_KEY)
  }

  const warm = analysis?.isWarm

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      {/* ambient glow mengikuti foto */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] blur-[120px] opacity-30 transition-colors duration-1000"
          style={{ background: analysis ? `linear-gradient(90deg, ${analysis.palette[0] || '#f59e0b'}, ${analysis.palette[2] || '#7c3aed'})` : 'linear-gradient(90deg,#f59e0b,#7c3aed)' }}
        />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] bg-violet-900/30 blur-[100px]" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* HEADER */}
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
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${playing ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
              <span className={`w-2 h-2 rounded-full ${playing ? 'bg-emerald-400 animate-pulse-glow' : 'bg-zinc-600'}`} />
              {playing ? 'Memutar' : 'Berhenti'}
            </span>
          </div>
        </header>

        <div className="grid lg:grid-cols-5 gap-5">
          {/* KIRI — upload + analisis */}
          <section className="lg:col-span-3 space-y-5">
            {/* Dropzone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
              className={`cursor-pointer rounded-3xl border-2 border-dashed transition-all overflow-hidden ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-zinc-700 bg-zinc-900/60 hover:border-zinc-500'}`}
            >
              {!imgSrc ? (
                <div className="py-14 px-6 text-center space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center animate-float-slow">
                    <ImagePlus size={26} className="text-amber-400" />
                  </div>
                  <p className="font-semibold">Seret & letakkan foto di sini</p>
                  <p className="text-xs text-zinc-400">atau klik untuk memilih • JPG / PNG / WEBP • diproses lokal di browser</p>
                  <span className="inline-flex items-center gap-2 text-xs bg-white text-black font-semibold px-4 py-2 rounded-full mt-2">
                    <Upload size={14} /> Pilih Foto
                  </span>
                </div>
              ) : (
                <div className="relative group">
                  <img src={imgSrc} alt="upload" className="w-full max-h-[380px] object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                    <span className="text-xs bg-black/60 backdrop-blur px-3 py-1.5 rounded-full truncate max-w-[60%]">{fileName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
                      className="text-xs flex items-center gap-1.5 bg-white text-black font-semibold px-3 py-1.5 rounded-full hover:bg-amber-300"
                    >
                      <RotateCcw size={13} /> Ganti
                    </button>
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </div>

            {/* Hasil analisis */}
            <div className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 space-y-4 backdrop-blur">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Palette size={15} className="text-amber-400" /> Ekstraksi Warna & Cahaya</h2>
                {analyzing && <span className="text-xs text-amber-300 flex items-center gap-1.5"><Sparkles size={13} className="animate-spin" /> Menganalisis piksel…</span>}
              </div>

              {!analysis ? (
                <p className="text-xs text-zinc-500 leading-relaxed flex gap-2"><Info size={14} className="shrink-0 mt-0.5" /> Unggah foto untuk membaca RGBA via &lt;canvas&gt;, lalu hitung brightness, saturasi, suhu warna, dan kontras secara otomatis.</p>
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
                  <div className="flex flex-wrap gap-2 text-[11px] pt-1">
                    <span className={`px-2.5 py-1 rounded-full border ${warm ? 'border-orange-400/40 bg-orange-400/10 text-orange-300' : 'border-sky-400/40 bg-sky-400/10 text-sky-300'}`}>
                      {warm ? '☀ Foto Hangat' : '❄ Foto Dingin'} • Hue {analysis.hue}°
                    </span>
                    <span className="px-2.5 py-1 rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300">
                      {analysis.brightness >= 68 ? 'Terang → oktaf tinggi' : analysis.brightness <= 32 ? 'Gelap → oktaf rendah / bass' : 'Sedang → oktaf tengah'}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Riwayat */}
            <div className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 space-y-3 backdrop-blur">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><History size={15} className="text-violet-400" /> Memori Tersimpan <span className="text-zinc-500 font-normal">• LocalStorage</span></h2>
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-[11px] flex items-center gap-1 text-zinc-400 hover:text-red-400"><Trash2 size={12} /> Hapus</button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-zinc-500">Belum ada riwayat. Setiap foto yang dianalisis tersimpan otomatis di browser ini.</p>
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

          {/* KANAN — player */}
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
                  <p className="text-xs text-zinc-500">Musik muncul setelah foto dianalisis.<br />Nada, tempo & instrumen mengikuti warna foto.</p>
                </div>
              ) : (
                <>
                  <div className={`rounded-2xl p-4 border ${warm ? 'border-orange-400/30 bg-orange-400/5' : 'border-sky-400/30 bg-sky-400/5'}`}>
                    <p className="text-[11px] uppercase tracking-widest opacity-70 flex items-center gap-1.5">
                      {warm ? <Sun size={12} /> : <Moon size={12} />} Tangga nada terdeteksi
                    </p>
                    <p className="text-xl font-bold mt-0.5">{music.scaleName}</p>
                    <p className="text-xs text-zinc-400">{music.mood}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {music.notes.map((n) => (
                        <span key={n} className="text-[11px] font-mono px-2 py-1 rounded-lg bg-black/50 border border-white/10">{n}{Math.min(6, Math.max(1, music.octave + octaveShift))}</span>
                      ))}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1"><Timer size={11} /> {music.density} • attack {music.attack}s • release {music.release}s</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={togglePlay}
                      className={`flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-3 rounded-2xl transition active:scale-95 ${playing ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-white text-black hover:bg-amber-300'}`}
                    >
                      {playing ? <><Pause size={17} /> Pause Loop</> : <><Play size={17} /> Mainkan Musik Foto</>}
                    </button>
                    <button onClick={handleStop} title="Stop" className="w-12 h-12 rounded-2xl border border-zinc-700 bg-zinc-900 flex items-center justify-center hover:border-red-400 hover:text-red-400 transition">
                      <Square size={16} />
                    </button>
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5"><SlidersHorizontal size={12} /> MIXER — atur sesuai selera</p>
                    <Slider icon={Volume2} label="Volume" value={volume} min={0} max={100} onChange={setVolume} suffix="%" />
                    <Slider icon={Gauge} label="Tempo (BPM)" value={bpm} min={50} max={120} onChange={setBpmState} />
                    <Slider icon={Waves} label="Reverb / Ruang" value={wet} min={0} max={100} onChange={setWetState} suffix="%" />
                    <Slider icon={Layers} label="Geser Oktaf" value={octaveShift} min={-2} max={2} onChange={setOctaveShift} />
                    <p className="text-[10px] text-zinc-500 leading-relaxed">Perubahan tempo & reverb diterapkan live ke Tone.js Transport tanpa menghentikan loop.</p>
                  </div>
                </>
              )}

              <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-3.5 text-[11px] text-zinc-400 leading-relaxed space-y-1.5">
                <p className="font-semibold text-zinc-300 flex items-center gap-1.5"><Heart size={11} className="text-pink-400" /> Logika pemetaan</p>
                <p>• <b className="text-zinc-200">Hangat</b> (merah/oranye) → Mayor ceria • <b className="text-zinc-200">Dingin</b> (biru/hijau) → Minor / Dorian</p>
                <p>• <b className="text-zinc-200">Terang</b> → oktaf tinggi (bel/synth) • <b className="text-zinc-200">Gelap</b> → oktaf rendah (bass/selo)</p>
                <p>• <b className="text-zinc-200">Kontras tinggi</b> → tempo cepat & variatif • <b className="text-zinc-200">Soft</b> → drone lambat & halus</p>
              </div>
            </div>
          </section>
        </div>

        <footer className="text-center text-[11px] text-zinc-600 pb-4">
          Dibuat untuk penggunaan pribadi • React + Tone.js + Lucide • Tanpa server, tanpa biaya — semua di browser.
        </footer>
      </div>
    </div>
  )
}
