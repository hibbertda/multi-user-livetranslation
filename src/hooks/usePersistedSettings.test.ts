import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePersistedSettings } from './usePersistedSettings';
import { fetchUserSettings, saveUserSettings } from '../services/sessionStoreService';

vi.mock('../services/sessionStoreService', () => ({
  fetchUserSettings: vi.fn(),
  saveUserSettings: vi.fn(),
}));

const STORAGE_KEY = 'live-translation-settings';
const fetchUserSettingsMock = vi.mocked(fetchUserSettings);
const saveUserSettingsMock = vi.mocked(saveUserSettings);

describe('usePersistedSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchUserSettingsMock.mockReset();
    saveUserSettingsMock.mockReset();
    fetchUserSettingsMock.mockResolvedValue(null);
    saveUserSettingsMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with defaults when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedSettings(undefined, undefined));

    expect(result.current.settings).toEqual({ microphoneDeviceId: '', translationMode: 'standard' });
  });

  it('loads stored settings from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ microphoneDeviceId: 'mic-1', translationMode: 'realtime' }));

    const { result } = renderHook(() => usePersistedSettings(undefined, undefined));

    expect(result.current.settings).toEqual({ microphoneDeviceId: 'mic-1', translationMode: 'realtime' });
  });

  it('merges partial stored settings over defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ translationMode: 'realtime' }));

    const { result } = renderHook(() => usePersistedSettings(undefined, undefined));

    expect(result.current.settings).toEqual({ microphoneDeviceId: '', translationMode: 'realtime' });
  });

  it('falls back to defaults when stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    const { result } = renderHook(() => usePersistedSettings(undefined, undefined));

    expect(result.current.settings).toEqual({ microphoneDeviceId: '', translationMode: 'standard' });
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => usePersistedSettings(undefined, undefined));

    act(() => {
      result.current.updateSettings({ microphoneDeviceId: 'mic-9' });
    });

    expect(result.current.settings.microphoneDeviceId).toBe('mic-9');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      microphoneDeviceId: 'mic-9',
      translationMode: 'standard',
    });
  });

  it('hydrates from the API when a user and token provider are available', async () => {
    fetchUserSettingsMock.mockResolvedValue({ microphoneDeviceId: 'mic-remote', translationMode: 'realtime' });
    const getApiToken = vi.fn().mockResolvedValue('token');

    const { result } = renderHook(() => usePersistedSettings('user-1', getApiToken));

    await waitFor(() => expect(result.current.settings.microphoneDeviceId).toBe('mic-remote'));
    expect(fetchUserSettingsMock).toHaveBeenCalledWith('user-1', 'token');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).translationMode).toBe('realtime');
  });

  it('only loads remote settings once across re-renders', async () => {
    const getApiToken = vi.fn().mockResolvedValue('token');
    const { rerender } = renderHook(() => usePersistedSettings('user-1', getApiToken));

    await waitFor(() => expect(fetchUserSettingsMock).toHaveBeenCalledTimes(1));
    rerender();
    rerender();

    expect(fetchUserSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps local settings when the remote load fails', async () => {
    fetchUserSettingsMock.mockRejectedValue(new Error('offline'));
    const getApiToken = vi.fn().mockResolvedValue('token');

    const { result } = renderHook(() => usePersistedSettings('user-1', getApiToken));

    await waitFor(() => expect(fetchUserSettingsMock).toHaveBeenCalled());
    expect(result.current.settings).toEqual({ microphoneDeviceId: '', translationMode: 'standard' });
  });

  it('pushes updates to the API when signed in', async () => {
    const getApiToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(() => usePersistedSettings('user-1', getApiToken));

    act(() => {
      result.current.updateSettings({ translationMode: 'realtime' });
    });

    await waitFor(() => expect(saveUserSettingsMock).toHaveBeenCalledWith(
      'user-1',
      { microphoneDeviceId: '', translationMode: 'realtime' },
      'token',
    ));
  });

  it('does not call the API when signed out', () => {
    const { result } = renderHook(() => usePersistedSettings(undefined, undefined));

    act(() => {
      result.current.updateSettings({ translationMode: 'realtime' });
    });

    expect(saveUserSettingsMock).not.toHaveBeenCalled();
  });
});
