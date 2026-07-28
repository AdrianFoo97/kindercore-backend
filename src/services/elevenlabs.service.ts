const SAMPLE_RATE = 16000; // pcm_16000 — broadly available across ElevenLabs plans

/**
 * Calls ElevenLabs TTS and returns mono PCM16 audio wrapped in a WAV
 * container. ElevenLabs' `pcm_*` output format is headerless raw samples,
 * so we add the 44-byte WAV header ourselves — needed for both the admin
 * `<audio>` preview and ESP32-side WAV playback.
 */
export async function generateSpeechWav(text: string, voiceId: string): Promise<{ buffer: Buffer; sampleRate: number }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_${SAMPLE_RATE}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/*',
      },
      body: JSON.stringify({ text, model_id: modelId }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs request failed (${res.status}): ${body || res.statusText}`);
  }

  const pcm = Buffer.from(await res.arrayBuffer());
  return { buffer: pcmToWav(pcm, SAMPLE_RATE), sampleRate: SAMPLE_RATE };
}

/** Wraps raw PCM16 mono samples in a standard 44-byte WAV header. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitDepth = 16;
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
