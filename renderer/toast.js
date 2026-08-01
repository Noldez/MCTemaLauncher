const q = new URLSearchParams(location.search);
const title = q.get('title') || '';
const body = q.get('body') || '';
const nick = q.get('nick') || '';

document.getElementById('title').textContent = title;
document.getElementById('body').textContent = body;
const av = document.getElementById('av');
if (nick) {
  av.src = `https://mc-heads.net/avatar/${encodeURIComponent(nick)}/38`;
  av.onerror = () => { av.src = 'logo-64.png'; av.classList.add('logo'); };
} else {
  av.src = 'logo-64.png';
  av.classList.add('logo');
}

const leave = (cb) => {
  const t = document.getElementById('t');
  t.classList.add('out');
  setTimeout(cb, 230);
};
document.getElementById('t').addEventListener('click', (e) => {
  if (e.target.id === 'x') return;
  leave(() => window.toastApi.open(nick));
});
document.getElementById('x').addEventListener('click', (e) => {
  e.stopPropagation();
  leave(() => window.toastApi.dismiss());
});
setTimeout(() => leave(() => window.toastApi.dismiss()), 6500);
