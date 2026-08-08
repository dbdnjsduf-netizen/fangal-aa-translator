import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePortableVisualOverflow } from '../services/visualTextMetrics';

test('미세한 렌더링 오차는 무시하고 실제 한 칸 초과만 보정한다', () => {
  assert.equal(calculatePortableVisualOverflow(80, 81, 0, 8), 0);
  assert.equal(calculatePortableVisualOverflow(80, 89, 0, 8), 1);
});

test('시각 폭 보정은 기존 셀 초과량보다 최대 두 칸까지만 추가한다', () => {
  assert.equal(calculatePortableVisualOverflow(80, 120, 0, 8), 2);
  assert.equal(calculatePortableVisualOverflow(80, 128, 3, 8), 5);
});
