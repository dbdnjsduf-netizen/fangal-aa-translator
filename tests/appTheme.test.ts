import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAppTheme } from '../services/appTheme';

test('화이트 모드만 명시적으로 복구하고 나머지는 안전하게 다크 모드로 시작한다', () => {
  assert.equal(normalizeAppTheme('light'), 'light');
  assert.equal(normalizeAppTheme('dark'), 'dark');
  assert.equal(normalizeAppTheme('unknown'), 'dark');
  assert.equal(normalizeAppTheme(null), 'dark');
});
