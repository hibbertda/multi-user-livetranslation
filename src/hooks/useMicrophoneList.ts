import { useState, useEffect, useCallback } from 'react';

export function useMicrophoneList() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const refresh = useCallback(async () => {
    // Request permission first so labels are populated
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Permission denied — we'll show an empty list
    }

    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all.filter((d) => d.kind === 'audioinput');
    setDevices(mics);

    // Keep current selection if still valid, otherwise pick default
    if (!mics.find((d) => d.deviceId === selectedDeviceId)) {
      setSelectedDeviceId(mics[0]?.deviceId ?? '');
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [refresh]);

  return { devices, selectedDeviceId, setSelectedDeviceId };
}
