const MAX_DURATION_SEC = 60; // সর্বোচ্চ ৬০ সেকেন্ডের ভয়েস মেসেজ

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function createVoiceRecorder({ onTick, onAutoStop }) {
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];
  let timer = null;
  let seconds = 0;
  let isCancelled = false;

  function cleanup() {
    clearInterval(timer);
    timer = null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Voice recording is not supported in this browser.");
    }

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    seconds = 0;
    isCancelled = false;

    const mimeType = getSupportedMimeType();
    const options = mimeType
      ? { mimeType, audioBitsPerSecond: 32000 }
      : { audioBitsPerSecond: 32000 };

    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();
    onTick(0);

    timer = setInterval(() => {
      seconds++;
      onTick(seconds);
      if (seconds >= MAX_DURATION_SEC && onAutoStop) {
        onAutoStop();
      }
    }, 1000);
  }

  function stop() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        cleanup();
        resolve(null);
        return;
      }

      const finalDuration = seconds;
      mediaRecorder.onstop = () => {
        cleanup();
        if (isCancelled || chunks.length === 0) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not process voice note."));
        reader.onloadend = () => resolve({ fileData: reader.result, duration: finalDuration });
        reader.readAsDataURL(blob);
      };

      mediaRecorder.stop();
    });
  }

  function cancel() {
    isCancelled = true;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      cleanup();
    }
  }

  function isRecording() {
    return mediaRecorder && mediaRecorder.state === "recording";
  }

  return { start, stop, cancel, isRecording };
}
