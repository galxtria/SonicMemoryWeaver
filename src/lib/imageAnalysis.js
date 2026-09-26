// Analisis piksel client-side via <canvas> — tanpa server, tanpa lib berat.

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  const v = max
  return { h, s: s * 100, v: v * 100 }
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export async function analyzeImage(imgSrc) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = imgSrc
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
  })

  const W = 120, H = 120
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  // cover-fit draw
  const ir = img.width / img.height, cr = W / H
  let sw, sh, sx, sy
  if (ir > cr) { sh = img.height; sw = sh * cr; sx = (img.width - sw) / 2; sy = 0 }
  else { sw = img.width; sh = sw / cr; sx = 0; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data

  let rSum = 0, gSum = 0, bSum = 0
  let lumSum = 0, satSum = 0
  const lums = []
  const buckets = new Map()
  const n = W * H

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    rSum += r; gSum += g; bSum += b
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lumSum += lum
    lums.push(lum)
    const { s } = rgbToHsv(r, g, b)
    satSum += s
    // quantize untuk palet dominan (4 bit per channel)
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`
    const cur = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 }
    cur.count++; cur.r += r; cur.g += g; cur.b += b
    buckets.set(key, cur)
  }

  const avgR = rSum / n, avgG = gSum / n, avgB = bSum / n
  const brightness = lumSum / n / 255 * 100
  const saturation = satSum / n
  // warmth: dominasi merah-kuning vs biru (0=dingin, 100=hangat)
  const warmth = Math.max(0, Math.min(100, 50 + (avgR - avgB) / 2.55 * 0.9))
  // contrast: stddev luminance normalized
  const mean = lumSum / n
  const variance = lums.reduce((a, l) => a + (l - mean) ** 2, 0) / n
  const contrast = Math.min(100, (Math.sqrt(variance) / 128) * 100)

  const palette = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((c) => toHex(
      Math.round(c.r / c.count),
      Math.round(c.g / c.count),
      Math.round(c.b / c.count)
    ))

  const avgHsv = rgbToHsv(avgR, avgG, avgB)

  return {
    avg: { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) },
    brightness: Math.round(brightness),
    saturation: Math.round(saturation),
    warmth: Math.round(warmth),
    contrast: Math.round(contrast),
    hue: Math.round(avgHsv.h),
    isWarm: warmth >= 52,
    palette,
    width: img.width,
    height: img.height,
  }
}

export const SCALES = {
  major: { name: 'Mayor Ceria', notes: ['C', 'D', 'E', 'G', 'A'], mood: 'Hangat • ceria • bersemangat' },
  minor: { name: 'Minor Melankolis', notes: ['A', 'C', 'D', 'E', 'G'], mood: 'Dingin • tenang • melankolis' },
  dorian: { name: 'Dorian Misterius', notes: ['D', 'E', 'F', 'G', 'A', 'C'], mood: 'Dingin • misterius • dreamy' },
}

export function getScale(key) {
  return SCALES[key] || SCALES.major
}

export function mapToMusic(a) {
  // 1. Suhu -> tangga nada
  let scaleKey = 'major'
  if (!a.isWarm) scaleKey = a.saturation < 35 ? 'dorian' : 'minor'
  else if (a.saturation < 25) scaleKey = 'major' // hangat pudar tetap mayor tapi soft

  // 2. Brightness -> oktaf
  let octave = 4
  if (a.brightness >= 68) octave = 5
  else if (a.brightness <= 32) octave = 3
  if (a.brightness <= 15) octave = 2

  // 3. Kontras/saturasi -> tempo & densitas
  const bpm = Math.round(58 + (a.contrast / 100) * 44 + (a.saturation / 100) * 14) // 58–116
  const density = a.contrast > 60 ? 'ramai • interval cepat' : a.contrast < 30 ? 'minimalis • drone panjang' : 'seimbang'
  const attack = a.contrast < 30 ? 1.8 : 0.4
  const release = a.contrast < 30 ? 6 : 3

  const scale = SCALES[scaleKey]
  return {
    scaleKey, scaleName: scale.name, notes: scale.notes, mood: scale.mood,
    octave, bpm, density, attack, release,
    rootFreqHint: `${scale.notes[0]}${octave}`,
  }
}
