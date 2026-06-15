import { useState, useCallback, useEffect, useRef } from 'react';
import type { TranslationMode } from '../types';
import { fetchUserSettings, saveUserSettings } from '../services/sessionStoreService';

const STORAGE_KEY = 'live-translation-settings';

export interface PersistedSettings {
  microphoneDeviceId: string;
  translationMode: TranslationMode;
}

const DEFAULTS: PersistedSettings = {
  microphoneDeviceId: '',
  translationMode: 'standard',
};

function loadLocal(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function saveLocal(settings: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function usePersistedSettings(userId?: string) {
  const [settings, setSettingsState] = useState<PersistedSettings>(loadLocal);
  const loadedRef = useRef(false);

  // Load from Cosmos on mount when userId is available
  useEffect(() => {
    if (!userId || loadedRef.current) return;
    loadedRef.current = true;
    fetchUserSettings(userId).then((remote) => {
      if (remote) {
        const merged = { ...DEFAULTS, ...remote };
        setSettingsState(merged);
        saveLocal(merged);
      }
    });
  }, [userId]);

  const updateSettings = useCallback((patch: Partial<PersistedSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveLocal(next);
      if (userId) {
        void saveUserSettings(userId, next);
      }
      return next;
    });
  }, [userId]);

  return { settings, updateSettings };
}
