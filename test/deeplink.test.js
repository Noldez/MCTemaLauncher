const test = require('node:test');
const assert = require('node:assert');
const { parseDeepLink, linkFromArgv } = require('../lib/deeplink');

test('parses the three supported actions', () => {
  assert.deepEqual(parseDeepLink('mctema://open'), { action: 'open' });
  assert.deepEqual(parseDeepLink('mctema://play'), { action: 'play' });
  assert.deepEqual(parseDeepLink('mctema://friend/ZooH_'), { action: 'friend', nick: 'ZooH_' });
});

test('scheme and action are case-insensitive, nick keeps its case', () => {
  assert.deepEqual(parseDeepLink('MCTEMA://Open'), { action: 'open' });
  assert.deepEqual(parseDeepLink('mctema://FRIEND/Noldez'), { action: 'friend', nick: 'Noldez' });
});

test('rejects malformed nicks instead of passing them through', () => {
  assert.equal(parseDeepLink('mctema://friend/ab'), null);
  assert.equal(parseDeepLink('mctema://friend/<script>'), null);
  assert.equal(parseDeepLink('mctema://friend/'), null);
  assert.equal(parseDeepLink('mctema://friend/way_too_long_nickname_here'), null);
});

test('rejects unknown actions and foreign schemes', () => {
  assert.equal(parseDeepLink('mctema://format-c'), null);
  assert.equal(parseDeepLink('https://mctema.lt/open'), null);
  assert.equal(parseDeepLink('mctema:open'), null);
  assert.equal(parseDeepLink(''), null);
  assert.equal(parseDeepLink(null), null);
});

test('linkFromArgv finds the protocol arg among installer noise', () => {
  assert.equal(
    linkFromArgv(['MCTemaLauncher.exe', '--allow-file-access', 'mctema://friend/Aistelo']),
    'mctema://friend/Aistelo',
  );
  assert.equal(linkFromArgv(['MCTemaLauncher.exe']), null);
  assert.equal(linkFromArgv(null), null);
});
