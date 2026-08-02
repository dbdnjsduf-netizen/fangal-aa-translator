import { AppTheme } from '../types';

export const APP_THEME_STORAGE_KEY = 'aat_app_theme_v1';

export function normalizeAppTheme(value: string | null | undefined): AppTheme {
  return value === 'light' ? 'light' : 'dark';
}
