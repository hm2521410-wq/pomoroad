import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDrawer } from '../src/js/ui/drawer-state.js';

test('設定のタブを切り替えてもパネルは閉じない（どのタブからどのタブへでも）', () => {
  const tabs = ['timer', 'alerts', 'guard', 'view', 'mini', 'keys', 'system', 'data'];
  for (const from of tabs) {
    for (const to of tabs) {
      const next = nextDrawer({ drawer: 'settings', tab: from }, { type: 'tab', tab: to });
      assert.deepEqual(next, { drawer: 'settings', tab: to }, `${from} → ${to}`);
    }
  }
});

test('下のボタン：同じものをもう一度押すと閉じ、違うものなら開く', () => {
  assert.equal(nextDrawer({ drawer: 'sounds', tab: 'alerts' }, { type: 'tool', kind: 'sounds' }).drawer, null);
  assert.equal(nextDrawer({ drawer: 'settings', tab: 'timer' }, { type: 'tool', kind: 'settings', tab: 'timer' }).drawer, null);
  assert.deepEqual(nextDrawer({ drawer: 'settings', tab: 'timer' }, { type: 'tool', kind: 'settings', tab: 'alerts' }), { drawer: 'settings', tab: 'alerts' });
  assert.deepEqual(nextDrawer({ drawer: null, tab: null }, { type: 'tool', kind: 'stats' }), { drawer: 'stats', tab: 'timer' });
  assert.deepEqual(nextDrawer({ drawer: 'stats', tab: 'guard' }, { type: 'tool', kind: 'settings', tab: 'guard' }), { drawer: 'settings', tab: 'guard' });
});
