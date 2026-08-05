// Crash dialog: shown when the game process exits non-zero. Siusti loga ships
// the console tail to mctema.lt so support sees the evidence, not just
// "neveikia". Lives at body level like the shop modal - view sections animate
// transform and would trap a fixed overlay.
(() => {
  const { $ } = window.ui;
  const modal = $('crash-modal');

  window.api.onCrash((p) => {
    $('cr-sub').textContent = `Žaidimo procesas baigė darbą su klaida (kodas: ${p.exitCode}).`;
    const wrap = $('cr-cause-wrap');
    if (p.suspectedCause) {
      $('cr-cause').textContent = p.suspectedCause;
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
    }
    $('cr-send').disabled = false;
    $('cr-sent').classList.add('hidden');
    modal.classList.remove('hidden');
  });

  // Deliberately no click-outside-to-close: a stray click beside a crash
  // report would throw away the log before you had a chance to send it. The
  // close button is the way out.
  const close = () => modal.classList.add('hidden');
  $('cr-close').addEventListener('click', close);

  $('cr-relaunch').addEventListener('click', () => {
    close();
    const play = document.getElementById('btn-play');
    if (play && !play.disabled) play.click();
  });

  $('cr-copy').addEventListener('click', async () => {
    await window.api.crashCopy();
    document.dispatchEvent(new CustomEvent('notify', { detail: { text: 'Logas nukopijuotas.', kind: 'info' } }));
  });

  $('cr-send').addEventListener('click', async () => {
    const btn = $('cr-send');
    btn.disabled = true;
    let r;
    try { r = await window.api.crashSend(); } catch { r = null; }
    if (r && r.ok) {
      const sent = $('cr-sent');
      sent.textContent = `Išsiųsta - pranešimo nr. #${r.id}. Nurodyk jį rašydamas mums.`;
      sent.classList.remove('hidden');
      return;
    }
    btn.disabled = false;
    document.dispatchEvent(new CustomEvent('notify', {
      detail: { text: (r && r.error) || 'Nepavyko išsiųsti logo.', kind: 'error' },
    }));
  });

  $('cr-discord').addEventListener('click', () => window.ui.openUrl('https://discord.gg/qCJCUuTuFj'));
})();
