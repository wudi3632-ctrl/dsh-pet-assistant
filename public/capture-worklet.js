class PetCapture extends AudioWorkletProcessor {
  constructor() { super(); this.parts = []; this.count = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.parts.push(new Float32Array(channel)); this.count += channel.length;
      if (this.count >= sampleRate * 0.08) {
        const joined = new Float32Array(this.count); let offset = 0;
        for (const part of this.parts) { joined.set(part, offset); offset += part.length; }
        // AudioContext is requested at 16kHz; resample here if the device/browser differs.
        const ratio = sampleRate / 16000;
        const output = new Float32Array(Math.floor(joined.length / ratio));
        for (let i = 0; i < output.length; i++) {
          const pos = i * ratio, left = Math.floor(pos), fraction = pos - left;
          output[i] = joined[left] * (1 - fraction) + joined[Math.min(left + 1, joined.length - 1)] * fraction;
        }
        this.port.postMessage(output, [output.buffer]); this.parts = []; this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('pet-capture', PetCapture);
