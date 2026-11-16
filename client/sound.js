// Tiếng "cộp" khi đặt quân, tạo bằng WebAudio nên không cần file âm thanh.

let ctx = null;
let enabled = true;

export function setSoundEnabled(value) {
  enabled = value;
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Trình duyệt chỉ cho phát âm thanh sau một thao tác của người dùng.
export function unlockAudio() {
  ensure();
}

export function playClack(strong = false) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(strong ? 260 : 200, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.09);
  gain.gain.setValueAtTime(strong ? 0.9 : 0.6, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.13);

  const len = Math.floor(c.sampleRate * 0.03);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2200;
  const noiseGain = c.createGain();
  noiseGain.gain.value = strong ? 0.5 : 0.3;
  src.connect(filter).connect(noiseGain).connect(c.destination);
  src.start(t);
}
