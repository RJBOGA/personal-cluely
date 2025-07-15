// Keep a global reference to the audio context
let audioContext: AudioContext | null = null;

export type AudioCaptureStreams = {
  combinedStream: MediaStream;
  micStream: MediaStream;
  systemStream: MediaStream;
};

/**
 * Starts capturing ONLY system audio.
 *
 * @returns A promise that resolves to an object containing the system stream.
 */
export async function startSystemAudioCapture(): Promise<Pick<AudioCaptureStreams, 'combinedStream' | 'systemStream'>> {
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContext();
    }

    // 1. Capture system audio loopback
    await window.api.enableLoopback();
    const systemStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    const systemSource = audioContext.createMediaStreamSource(systemStream);

    // 2. Create a destination node. The "combined" stream will now only contain system audio.
    const destination = audioContext.createMediaStreamDestination();
    systemSource.connect(destination);

    const combinedStream = destination.stream;

    // Return a structure that matches what the calling code expects, omitting the micStream.
    return { combinedStream, systemStream };
  } catch (err) {
    console.error('Error starting system-only audio capture:', err);
    await stopAudioCapture({} as AudioCaptureStreams); // Best-effort cleanup
    throw err;
  }
}

/**
 * Stops all provided audio streams and disables system audio loopback.
 *
 * @param streams An object containing the streams to stop.
 */
export async function stopAudioCapture(streams: Partial<AudioCaptureStreams>): Promise<void> {
  streams.combinedStream?.getTracks().forEach((track) => track.stop());
  streams.micStream?.getTracks().forEach((track) => track.stop());
  streams.systemStream?.getTracks().forEach((track) => track.stop());

  // Close the audio context if it exists
  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
    audioContext = null;
  }

  // Tell the main process to disable system audio loopback.
  await window.api.disableLoopback().catch((err) => {
    console.error('Failed to disable loopback on cleanup:', err);
  });
}
