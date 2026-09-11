import { useState, useEffect, useCallback, useRef } from 'react';
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

export function usePersistedSettings(userId: string | undefined, getApiToken: (() => Promise<string>) | undefined) {
  const [settings, setSettingsState] = useState<PersistedSettings>(loadLocal);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!userId || !getApiToken || loadedRef.current) return;
    loadedRef.current = true;
    void getApiToken().then((accessToken) => fetchUserSettings(userId, accessToken)).then((remote) => {
      if (remote) {
        const merged = { ...DEFAULTS, ...remote };
        setSettingsState(merged);
        saveLocal(merged);
      }
    }).catch(() => undefined);
  }, [getApiToken, userId]);

  const updateSettings = useCallback((patch: Partial<PersistedSettings>) => {
    setSettingsState((previous) => {
      const next = { ...previous, ...patch };
      saveLocal(next);
      if (userId && getApiToken) {
        void getApiToken().then((accessToken) => saveUserSettings(userId, next, accessToken)).catch(() => undefined);
      }
      return next;
    });
  }, [getApiToken, userId]);

  return { settings, updateSettings };
}
