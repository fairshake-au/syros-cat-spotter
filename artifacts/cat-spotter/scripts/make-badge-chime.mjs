// Writes assets/sounds/badge.wav: a short rising three-note chime (E5, G5, C6),
// mono, 16-bit, 11.025 kHz, about 0.85 s. Run: node scripts/make-badge-chime.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 11025;
const SECONDS = 0.85;
const NOTES = [
  { freq: 659.25, start: 0.0 }, // E5
  { freq: 783.99, start: 0.14 }, // G5
  { freq: 1046.5, start: 0.28 }, // C6
];

const total = Math.round(RATE * SECONDS);
const mix = new Float64Array(total);
for (const { freq, start } of NOTES) {
  const from = Math.round(start * RATE);
  for (let i = from; i < total; i++) {
    const t = (i - from) / RATE;
    const attack = Math.min(1, t / 0.006);
    const decay = Math.exp(-t * 6);
    const tone = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t);
    mix[i] += attack * decay * tone;
  }
}
// Fade the last 60 ms so the file ends on silence, then normalise to 0.8 of full scale.
const fade = Math.round(0.06 * RATE);
for (let i = 0; i < fade; i++) mix[total - 1 - i] *= i / fade;
const peak = Math.max(...mix.map(Math.abs));

const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) data.writeInt16LE(Math.round((mix[i] / peak) * 0.8 * 32767), i * 2);

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds', 'badge.wav');
writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote ${out} (${header.length + data.length} bytes)`);
