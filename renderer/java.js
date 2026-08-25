// Missing-runtime dialog: shown when the launch stops because the Java 21 the
// launcher ships is not on disk. It offers to fetch the runtime instead of
// asking for a full reinstall, and keeps the Siusti loga button around, because
// the launch log now says which paths were checked and what was beside them.
(() => {
  const { $ } = window.ui;
  const modal = $('java-modal');

  const setBusy = (busy, label) => {
    $('jv-fix').disabled = busy;
    $('jv-fix').innerHTML = label;
  };

  window.api.onJavaMissing((p) => {
    const canRepair = !p || p.canRepair !== false;
    $('jv-fix').classList.toggle('hidden', !canRepair);
    $('jv-sub').textContent = canRepair
      ? 'Trūksta Java 21, su kuria paleidžiamas žaidimas. Ją galima parsisiųsti dabar - žaidimo failai liks vietoje.'
      : 'Trūksta Java 21, su kuria paleidžiamas žaidimas. Perinstaliuok launcherį iš mctema.lt.';
    setBusy(false, '<i class="fa-solid fa-wrench"></i> Parsisiųsti Java');
    $('jv-sent').classList.add('hidden');
    $('jv-send').disabled = false;
    modal.classList.remove('hidden');
  });

  window.api.onJavaRepair((p) => {
    const pct = (p && p.percent) || 0;
    setBusy(true, `<i class="fa-solid fa-arrow-down"></i> Siunčiama... ${pct}%`);
  });

  $('jv-close').addEventListener('click', () => modal.classList.add('hidden'));

  $('jv-fix').addEventListener('click', async () => {
    setBusy(true, '<i class="fa-solid fa-arrow-down"></i> Siunčiama...');
    let r;
    try { r = await window.api.javaRepair(); } catch { r = null; }
    if (r && r.ok) {
      modal.classList.add('hidden');
      document.dispatchEvent(new CustomEvent('notify', { detail: { text: 'Java sutvarkyta - bandyk paleisti dar kartą.', kind: 'info' } }));
      const play = document.getElementById('btn-play');
      if (play && !play.disabled) play.click();
      return;
    }
    setBusy(false, '<i class="fa-solid fa-wrench"></i> Bandyti dar kartą');
    document.dispatchEvent(new CustomEvent('notify', {
      detail: { text: (r && r.error) || 'Nepavyko parsisiųsti Java.', kind: 'error' },
    }));
  });

  $('jv-send').addEventListener('click', async () => {
    const btn = $('jv-send');
    btn.disabled = true;
    let r;
    try { r = await window.api.crashSend(); } catch { r = null; }
    if (r && r.ok) {
      const sent = $('jv-sent');
      sent.textContent = `Išsiųsta - pranešimo nr. #${r.id}. Nurodyk jį rašydamas mums.`;
      sent.classList.remove('hidden');
      return;
    }
    btn.disabled = false;
    document.dispatchEvent(new CustomEvent('notify', {
      detail: { text: (r && r.error) || 'Nepavyko išsiųsti logo.', kind: 'error' },
    }));
  });

  $('jv-discord').addEventListener('click', () => window.ui.openUrl('https://discord.gg/qCJCUuTuFj'));
})();
