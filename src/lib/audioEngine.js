// Engine v3: motif berfrasa + 7th/9th + 4 voices + mix chain + humanize.
import * as Tone from 'tone'

let started = false
const nodes = {}
let loops = []
let mediaDest = null
let recorder = null
let chunks = []

function pick(arr, i) { return arr[((i % arr.length) + arr.length) % arr.length] }

export async function ensureCtx() {
  if (Tone.getContext().state !== 'started') await Tone.start()
}
export function getAnalyser() { return nodes.analyser || null }

function seededRand(seed) {
  let s = seed || 42
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function buildChords7(ext) {
  // 4-bar: Imaj9 – V – vi – IV style, diatonik pentatonik + ekstensi 7/9
  const prog = [[0, 2, 4, 6], [4, 6, 8, 10], [5, 7, 9, 11], [3, 5, 7, 9]]
  return prog.map((ch) => ch.map((i) => pick(ext, i)))
}

function buildMotif(rand, len, span) {
  // random-walk motif 8 langkah — ada pengulangan, tidak melompat liar
  const motif = []
  let idx = Math.floor(rand() * len)
  motif.push(idx)
  const steps = [-2, -1, -1, 0, 1, 1, 2, 0]
  for (let i = 1; i < 8; i++) {
    const st = steps[Math.floor(rand() * steps.length)]
    idx = Math.max(0, Math.min(span - 1, idx + st))
    motif.push(idx)
  }
  return motif
}

export async function startGenerative(p) {
  const {
    notes, octave = 4, bpm = 72, attack = 0.4, release = 3,
    warmth = 50, brightness = 50, saturation = 50, contrast = 50,
    scaleKey = 'major', padEnabled = true,
    cutoff = 4000, reverbDecay = 7, sparkleDensity = 0.3,
    timbre = 'airy', swing = 0.1,
  } = p
  await ensureCtx()
  stopGenerative(false)

  const rand = seededRand(Math.floor(warmth * 997 + brightness * 613 + (p.hue || 0) * 37 + notes.length * 77) || 42)

  // ---- master chain ----
  const analyser = new Tone.Analyser('fft', 64)
  const comp = new Tone.Compressor(-18, 3)
  const limiter = new Tone.Limiter(-1.5)
  const reverb = new Tone.Reverb({ decay: reverbDecay, wet: 0.5 })
  await reverb.generate()
  const chorus = new Tone.Chorus(2.2, 3.2, 0.35).start()
  const pingpong = new Tone.PingPongDelay('8n.', 0.32)
  pingpong.wet.value = 0.28

  // filter bernapas mengikuti brightness
  const filtCut = Math.max(500, Math.min(9000, cutoff))
  const leadFilter = new Tone.Filter(filtCut, 'lowpass')
  const filtLFO = new Tone.LFO(0.06, filtCut * 0.6, Math.min(10000, filtCut * 1.35))
  filtLFO.connect(leadFilter.frequency)
  filtLFO.start()

  // panner bergerak — terasa stereo di headphone
  const panner = new Tone.Panner(0)
  const panLFO = new Tone.LFO(0.08, -0.55, 0.55)
  panLFO.connect(panner.pan)
  panLFO.start()

  const leadGain = new Tone.Gain(0.8)
  const padGain = new Tone.Gain(0.32)
  const sparkGain = new Tone.Gain(0.5)
  const noiseGain = new Tone.Gain((1 - brightness / 120) * 0.06)

  // ---- voices ----
  const fmHar = timbre === 'bell' ? 3.01 : timbre === 'deep' ? 1.2 : timbre === 'warm' ? 2.4 : 1.5
  const lead = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: fmHar, modulationIndex: timbre === 'bell' ? 16 : 10,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.02, decay: 0.5, sustain: 0.35, release: Math.max(2, release) },
    modulation: { type: 'triangle' },
    modulationEnvelope: { attack: 0.05, decay: 0.6, sustain: 0.25, release: 2 },
  })
  const sparkle = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.35, sustain: 0.08, release: 2.5 },
  })
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: timbre === 'warm' || timbre === 'bell' ? 'fatsawtooth' : 'sine', spread: 25, count: 3 },
    envelope: { attack: 2.4, decay: 1.4, sustain: 0.8, release: 5 },
  })
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    filter: { Q: 1, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.4, decay: 0.4, sustain: 0.85, release: 3 },
    filterEnvelope: { attack: 0.3, decay: 0.5, sustain: 0.5, baseFrequency: 110, octaves: 2 },
  })
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 4, decay: 3, sustain: 0.9, release: 6 },
  })
  const noiseFilter = new Tone.Filter(480, 'lowpass')

  // routing
  lead.chain(leadFilter, panner, leadGain, pingpong, reverb)
  sparkle.chain(sparkGain, pingpong, reverb)
  pad.chain(padGain, chorus, reverb)
  bass.chain(reverb)
  noise.chain(noiseFilter, noiseGain, reverb)
  reverb.chain(comp, limiter, analyser, Tone.getDestination())
  if (mediaDest) { try { Tone.getDestination().connect(mediaDest) } catch {} }

  Object.assign(nodes, { analyser, comp, limiter, reverb, chorus, pingpong, leadFilter, filtLFO, panner, panLFO, leadGain, padGain, sparkGain, noiseGain, lead, sparkle, pad, bass, noise, noiseFilter })

  // ---- teori musik ----
  const T = Tone.getTransport()
  T.bpm.value = bpm
  T.swing = Math.max(0, Math.min(0.4, swing))
  T.swingSubdivision = '16n'

  const mel = notes.map((n) => `${n}${octave}`)
  const melHi = notes.map((n) => `${n}${Math.min(7, octave + 1)}`)
  const ext = [...mel, ...melHi] // 2 oktaf untuk motif & ekstensi
  const chords = buildChords7([...notes.map((n) => `${n}${Math.max(2, octave - 1)}`), ...mel])
  const motif = buildMotif(rand, notes.length, ext.length)

  let s8 = 0 // counter 8th-note
  const leadLoop = new Tone.Loop((time) => {
    const bar = Math.floor(s8 / 8) % 4
    const pos = s8 % 8
    s8++
    const r = rand()
    // struktur: bar 0-1 padat, bar 2 renggang (jeda), bar 3 variasi
    const gate = bar === 2 ? 0.38 : bar === 3 ? 0.62 : 0.78
    if (r > gate) return
    let deg = motif[pos % motif.length]
    if (bar === 3) deg = Math.min(ext.length - 1, deg + 2) // variasi: naik sekon
    if (bar === 2 && pos % 2 === 1) return // ruang bernapas
    const note = ext[deg]
    const vel = 0.35 + r * 0.55 // humanize velocity
    const dur = pos === 0 ? '4n' : r > 0.8 ? '4n' : '8n'
    const jt = (rand() - 0.5) * 0.03 // humanize ±15ms
    try { lead.triggerAttackRelease(note, dur, time + jt, vel) } catch {}
  }, '8n').start(0)

  const sparkLoop = new Tone.Loop((time) => {
    const r = rand()
    if (r > sparkleDensity) return // foto terang = chime sering
    const note = pick(melHi, Math.floor(r * 97))
    try { sparkle.triggerAttackRelease(note, '4n', time, 0.25 + r * 0.3) } catch {}
  }, '2n').start(0)

  let cb = 0
  const padLoop = padEnabled ? new Tone.Loop((time) => {
    const chord = chords[cb % chords.length]
    cb++
    try { pad.triggerAttackRelease(chord, '1m', time, 0.45) } catch {}
  }, '1m').start(0) : null

  let bb = 0
  const bassLoop = new Tone.Loop((time) => {
    const chord = chords[bb % chords.length]
    bb++
    // bass ngikutin root chord yang sedang bunyi (bukan root statis)
    const rootPc = chord[0].replace(/[0-9]/g, '')
    const low = `${rootPc}${Math.max(1, octave - 2)}`
    try { bass.triggerAttackRelease(low, '2n', time, 0.55) } catch {}
  }, '1m').start(0)

  const texLoop = (brightness < 55 || saturation < 45) ? new Tone.Loop((time) => {
    try { noise.triggerAttackRelease('2m', time, 0.5) } catch {}
  }, '2m').start(0) : null

  loops = [leadLoop, sparkLoop, padLoop, bassLoop, texLoop].filter(Boolean)
  T.start()
  started = true
  return { chords, motif }
}

export function stopGenerative(stopTransport = true) {
  loops.forEach((l) => { try { l.stop(); l.dispose() } catch {} })
  loops = []
  Object.values(nodes).forEach((n) => { try { n.dispose?.() } catch {} })
  Object.keys(nodes).forEach((k) => delete nodes[k])
  if (stopTransport) { try { Tone.getTransport().stop(); Tone.getTransport().cancel() } catch {} }
  started = false
}

export function setBpm(bpm) { try { Tone.getTransport().bpm.rampTo(bpm, 0.5) } catch {} }
export function setWet(v) {
  try { nodes.reverb && (nodes.reverb.wet.value = v) } catch {}
  try { nodes.pingpong && (nodes.pingpong.wet.value = v * 0.55) } catch {}
}
export function setVolumeDB(db) { try { Tone.getDestination().volume.value = db } catch {} }
export function isPlaying() { return started }

export function isRecording() { return !!recorder && recorder.state === 'recording' }
export async function startRecording() {
  await ensureCtx()
  const ctx = Tone.getContext().rawContext
  mediaDest = ctx.createMediaStreamDestination()
  Tone.getDestination().connect(mediaDest)
  chunks = []
  recorder = new MediaRecorder(mediaDest.stream)
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.start()
}
export function stopRecording() {
  return new Promise((resolve) => {
    if (!recorder) return resolve(null)
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      const url = URL.createObjectURL(blob)
      try { Tone.getDestination().disconnect(mediaDest) } catch {}
      recorder = null; mediaDest = null
      resolve({ url, blob })
    }
    try { recorder.stop() } catch { resolve(null) }
  })
}
