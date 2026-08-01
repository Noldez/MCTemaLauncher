(() => {
  const { $ } = window.ui;

  const chk = (id, on) => $(id).classList.toggle('on', !!on);

  function render(c) {
    $('set-ram').value = c.ram || 4;
    $('set-ram-val').textContent = `${c.ram || 4} GB`;
    chk('set-hide', c.closeOnPlay);
    chk('set-toasts', c.toasts !== false);
    $('set-account').textContent = c.username || '-';
    const res = c.resolution || {};
    $('set-resw').value = res.w || 1280;
    $('set-resh').value = res.h || 720;
    chk('set-fs', res.fullscreen);
    const jvmOn = !!(c.jvmArgs && c.jvmArgs.trim());
    chk('set-jvm-on', jvmOn);
    $('set-jvm').value = c.jvmArgs || '';
    $('set-jvm').disabled = !jvmOn;
  }
  document.addEventListener('cfg', (e) => render(e.detail));
  if (window.ui.state.cfg) render(window.ui.state.cfg);
  window.api.version().then((v) => { $('set-ver').textContent = v; });

  const resPatch = () => window.ui.setCfg({
    resolution: {
      w: Math.min(7680, Math.max(640, Number($('set-resw').value) || 1280)),
      h: Math.min(4320, Math.max(480, Number($('set-resh').value) || 720)),
      fullscreen: $('set-fs').classList.contains('on'),
    },
  });

  $('set-resw').addEventListener('change', resPatch);
  $('set-resh').addEventListener('change', resPatch);
  $('set-fs').addEventListener('click', () => { $('set-fs').classList.toggle('on'); resPatch(); });
  document.querySelectorAll('.chip[data-res]').forEach((b) => b.addEventListener('click', () => {
    const [w, h] = b.dataset.res.split('x').map(Number);
    $('set-resw').value = w;
    $('set-resh').value = h;
    resPatch();
  }));

  $('set-ram').addEventListener('input', () => { $('set-ram-val').textContent = `${$('set-ram').value} GB`; });
  $('set-ram').addEventListener('change', () => window.ui.setCfg({ ram: Number($('set-ram').value) }));
  $('set-hide').addEventListener('click', () => {
    $('set-hide').classList.toggle('on');
    window.ui.setCfg({ closeOnPlay: $('set-hide').classList.contains('on') });
  });
  $('set-toasts').addEventListener('click', () => {
    $('set-toasts').classList.toggle('on');
    window.ui.setCfg({ toasts: $('set-toasts').classList.contains('on') });
  });

  $('set-jvm-on').addEventListener('click', () => {
    const on = !$('set-jvm-on').classList.contains('on');
    chk('set-jvm-on', on);
    $('set-jvm').disabled = !on;
    if (!on) { $('set-jvm').value = ''; window.ui.setCfg({ jvmArgs: '' }); }
    else $('set-jvm').focus();
  });
  $('set-jvm').addEventListener('change', () => window.ui.setCfg({ jvmArgs: $('set-jvm').value.trim() }));

  $('set-folder').addEventListener('click', () => window.api.openFolder());
  $('set-logout').addEventListener('click', () => window.ui.logout());

  const overlay = document.getElementById('console-overlay');
  const out = $('co-out');
  const lines = [];
  document.addEventListener('mclog', (e) => {
    lines.push(e.detail);
    if (lines.length > 2000) lines.shift();
    if (!overlay.classList.contains('hidden')) {
      out.textContent = lines.join('\n');
      out.scrollTop = out.scrollHeight;
    }
  });
  $('set-console').addEventListener('click', () => {
    overlay.classList.remove('hidden');
    out.textContent = lines.join('\n');
    out.scrollTop = out.scrollHeight;
  });
  $('co-close').addEventListener('click', () => overlay.classList.add('hidden'));
  $('co-copy').addEventListener('click', () => navigator.clipboard.writeText(lines.join('\n')));
})();
