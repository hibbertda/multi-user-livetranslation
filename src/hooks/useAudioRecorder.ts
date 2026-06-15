import { useState, useCallback, useEffect, useRef } from 'react';
import { trackEvent } from '../utils/telemetry';

export function useAudioRecorder(deviceId?: string) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      activeStreamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      trackEvent('recording.start.success');
    } catch (error) {
      trackEvent('recording.start.failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Microphone access failed. Check browser permissions and selected device.', {
        cause: error,
      });
    }
  }, [deviceId]);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder) {
        resolve(new Blob());
        return;
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        activeStreamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        resolve(blob);
      };

      mediaRecorder.stop();
      setIsRecording(false);
    });
  }, []);

  const saveRecording = useCallback(async () => {
    const blob = await stopRecording();
    if (blob.size === 0) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${new Date().toISOString().slice(0, 19)}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    trackEvent('recording.save.success', { sizeBytes: blob.size });
  }, [stopRecording]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      activeStreamRef.current?.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    };
  }, []);

  return { isRecording, startRecording, stopRecording, saveRecording };
}
