/* تبديل الوضع الفاتح/الداكن: يُحفظ في المتصفح ويتبع تفضيل الجهاز أول مرة */
(function () {
  const KEY = 'ehsan-theme';
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  let mode = saved || (prefersDark() ? 'dark' : 'light');
  function apply() {
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-dm-theme', mode);
    const b = document.getElementById('themeToggle');
    if (b) {
      b.textContent = mode === 'dark' ? '☀️' : '🌙';
      b.title = mode === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن';
      b.setAttribute('aria-pressed', String(mode === 'dark'));
    }
  }
  function mount() {
    const bar = document.querySelector('.topbar-actions');
    if (!bar) return false;
    if (document.getElementById('themeToggle')) return true;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'themeToggle'; b.className = 'theme-btn'; b.setAttribute('aria-label', 'تبديل الوضع الداكن');
    b.addEventListener('click', () => {
      mode = mode === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, mode); } catch (e) {}
      apply();
    });
    bar.insertBefore(b, bar.firstChild);
    apply();
    return true;
  }
  apply();
  if (!mount()) document.addEventListener('DOMContentLoaded', mount);
})();
