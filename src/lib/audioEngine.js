// Audio engine generatif berbasis Tone.js — infinite ambient loop.
import * as Tone from 'tone'

let started = false
let synth = null
let bassSynth = null
let reverb = null
let delay = null
let analyser = null
let loop = null
let bassLoop = null
let step = 0

function pick(arr, i) { return arr[i % arr.length] }

export async function ensureCtx() {
  if (Tone.getContext().state !== 'started') await Tone.start()
}

export function getAnalyser() { return analyser }

export async function startGenerative({ notes, octave, bpm, attack, release, warmth, brightness }) {
  await ensureCtx()
  stopGenerative(false)

  const vol = new Tone.Gain(0.9)
  analyser = new Tone.Analyser('fft', 64)
  reverb = new Tone.Reverb({ decay: 7, wet: 0.55 })
  await reverb.generate()
  delay = new Tone.FeedbackDelay('8n.', 0.35)
  delay.wet.value = 0.25

  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: brightness > 60 ? 'triangle' : 'sine' },
    envelope: { attack, decay: 0.6, sustain: 0.6, release },
  })
  bassSynth = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    filter: { Q: 1, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.8, release: 4 },
    filterEnvelope: { attack: 0.4, decay: 0.5, sustain: 0.5, baseFrequency: 120, octaves: 2 },
  })

  synth.chain(delay, reverb, vol, analyser, Tone.getDestination())
  bassSynth.chain(reverb, Tone.getDestination())

  Tone.getTransport().bpm.value = bpm
  step = 0
  const scaleNotes = notes.map((n) => `${n}${octave}`)
  const lowRoot = `${notes[0]}${Math.max(1, octave - 2)}`

  // seed dari warmth agar melodi beda tiap foto tapi stabil
  let seed = Math.floor(warmth * 997 + brightness * 613) || 42
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }

  loop = new Tone.Loop((time) => {
    step++
    const r = rand()
    // skip kadang-kadang untuk nuansa minimalis
    if (r < 0.18) return
    const idx = Math.floor(r * scaleNotes.length * 2) % scaleNotes.length
    // kadang lompat oktaf atas untuk foto terang
    const up = brightness > 65 && r > 0.8 ? 12 : 0
    const note = scaleNotes[idx]
    // transposisi sederhana via frequency shift manual: mainkan note + kadang fifth
    synth.triggerAttackRelease(note, r > 0.7 ? '2n' : '4n', time)
    if (r > 0.85) {
      const fifth = pick(scaleNotes, idx + 2)
      synth.triggerAttackRelease(fifth, '8n', time + Tone.Time('16n').toSeconds())
    }
    void up
  }, '4n').start(0)

  bassLoop = new Tone.Loop((time) => {
    bassSynth.triggerAttackRelease(lowRoot, '1m', time, 0.5)
  }, '1m').start(0)

  Tone.getTransport().start()
  started = true
}

export function stopGenerative(stopTransport = true) {
  try { loop?.stop(); loop?.dispose() } catch {}
  try { bassLoop?.stop(); bassLoop?.dispose() } catch {}
  try { synth?.dispose() } catch {}
  try { bassSynth?.dispose() } catch {}
  try { reverb?.dispose() } catch {}
  try { delay?.dispose() } catch {}
  loop = bassLoop = synth = bassSynth = reverb = delay = null
  if (stopTransport) { try { Tone.getTransport().stop() } catch {} }
  started = false
  step = 0
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
