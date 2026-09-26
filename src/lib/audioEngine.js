// Audio engine generatif v2: melodi + chord pad + bass + record.
import * as Tone from 'tone'

let started = false
let synth = null
let bassSynth = null
let padSynth = null
let reverb = null
let delay = null
let analyser = null
let loop = null
let bassLoop = null
let padLoop = null

// --- recording ---
let mediaDest = null
let recorder = null
let chunks = []

function pick(arr, i) { return arr[((i % arr.length) + arr.length) % arr.length] }

export async function ensureCtx() {
  if (Tone.getContext().state !== 'started') await Tone.start()
}

export function getAnalyser() { return analyser }

function buildProgression(notes, octave) {
  // extended 2 oktaf agar chord selalu konsonan dalam skala pentatonik
  const ext = [
    ...notes.map((n) => `${n}${octave}`),
    ...notes.map((n) => `${n}${octave + 1}`),
  ]
  const progIdx = [
    [0, 2, 4],
    [3, 4, 6],
    [4, 5, 7],
    [2, 3, 5],
  ]
  return progIdx.map((ch) => ch.map((i) => pick(ext, i)))
}

export async function startGenerative({ notes, octave, bpm, attack, release, warmth, brightness, scaleKey = 'major', padEnabled = true }) {
  await ensureCtx()
  stopGenerative(false)

  const vol = new Tone.Gain(0.9)
  const padVol = new Tone.Gain(0.35)
  analyser = new Tone.Analyser('fft', 64)
  reverb = new Tone.Reverb({ decay: 8, wet: 0.55 })
  await reverb.generate()
  delay = new Tone.FeedbackDelay('8n.', 0.35)
  delay.wet.value = 0.25

  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: brightness > 60 ? 'triangle' : 'sine' },
    envelope: { attack, decay: 0.6, sustain: 0.6, release },
  })
  padSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 2.2, decay: 1.2, sustain: 0.8, release: 5 },
  })
  bassSynth = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    filter: { Q: 1, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.8, release: 4 },
    filterEnvelope: { attack: 0.4, decay: 0.5, sustain: 0.5, baseFrequency: 120, octaves: 2 },
  })

  synth.chain(delay, reverb, vol, analyser, Tone.getDestination())
  padSynth.chain(padVol, reverb)
  // jika sedang recording, sambungkan ulang ke mediaDest
  if (mediaDest) { try { Tone.getDestination().connect(mediaDest) } catch {} }
  bassSynth.chain(reverb, Tone.getDestination())

  Tone.getTransport().bpm.value = bpm
  const scaleNotes = notes.map((n) => `${n}${octave}`)
  const lowRoot = `${notes[0]}${Math.max(1, octave - 2)}`
  const chords = buildProgression(notes, Math.max(2, octave - 1))

  let seed = Math.floor(warmth * 997 + brightness * 613 + notes.length * 77) || 42
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }

  let chordStep = 0
  loop = new Tone.Loop((time) => {
    const r = rand()
    if (r < 0.18) return
    const idx = Math.floor(r * scaleNotes.length * 2) % scaleNotes.length
    const note = scaleNotes[idx]
    synth.triggerAttackRelease(note, r > 0.7 ? '2n' : '4n', time)
    if (r > 0.85) {
      const fifth = pick(scaleNotes, idx + 2)
      synth.triggerAttackRelease(fifth, '8n', time + Tone.Time('16n').toSeconds())
    }
  }, '4n').start(0)

  bassLoop = new Tone.Loop((time) => {
    bassSynth.triggerAttackRelease(lowRoot, '1m', time, 0.5)
  }, '1m').start(0)

  if (padEnabled) {
    padLoop = new Tone.Loop((time) => {
      const chord = chords[chordStep % chords.length]
      chordStep++
      padSynth.triggerAttackRelease(chord, '1m', time, 0.5)
    }, '1m').start(0)
  }

  Tone.getTransport().start()
  started = true
  return chords
}

export function stopGenerative(stopTransport = true) {
  try { loop?.stop(); loop?.dispose() } catch {}
  try { bassLoop?.stop(); bassLoop?.dispose() } catch {}
  try { padLoop?.stop(); padLoop?.dispose() } catch {}
  try { synth?.dispose() } catch {}
  try { bassSynth?.dispose() } catch {}
  try { padSynth?.dispose() } catch {}
  try { reverb?.dispose() } catch {}
  try { delay?.dispose() } catch {}
  loop = bassLoop = padLoop = synth = bassSynth = padSynth = reverb = delay = null
  if (stopTransport) { try { Tone.getTransport().stop(); Tone.getTransport().cancel() } catch {} }
  started = false
}

export function setBpm(bpm) {
  try { Tone.getTransport().bpm.rampTo(bpm, 0.5) } catch {}
}
export function setWet(v) {
  try { reverb.wet.value = v } catch {}
  try { if (delay) delay.wet.value = v * 0.5 } catch {}
}
export function setVolumeDB(db) {
  try { Tone.getDestination().volume.value = db } catch {}
}
export function isPlaying() { return started }

// --- Recording ke WAV/webm via MediaStreamDestination ---
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
