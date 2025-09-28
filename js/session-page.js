// ./js/session-page.js
import { supabase } from "./client.js"; // ← use your existing client module

// 1) Require auth
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    const url = new URL(location.href);
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(location.pathname)}`;
    window.location.replace(url.toString());
    return;
  }
})();

// 2) Sign out
document.getElementById('signout')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('/login');
});

// 3) Lesson loader
const readerTitle = document.getElementById('reader-title');
const readerMeta  = document.getElementById('reader-meta');
const readerPage  = document.getElementById('reader-page');

async function loadLesson(label, path) {
  readerTitle.textContent = label;
  readerMeta.textContent  = 'Loading…';

  try {
    const res = await fetch(path, { cache: 'no-store' });
    let html;
    if (!res.ok) {
      // Fallback text while you prepare the real file
      html = `
        <h3>${label}</h3>
        <div class="meta">Polish • Level A1</div>
        <p><em>(Content file not found at <code>${path}</code>. Showing placeholder text.)</em></p>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor,
        dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas
        ligula massa, varius a, semper congue, euismod non, mi.</p>
        <p>Proin porttitor, orci nec nonummy molestie, enim est eleifend mi, non fermentum diam nisl sit amet erat.
        Duis semper. Duis arcu massa, scelerisque vitae, consequat in, pretium a, enim. Pellentesque congue.</p>
      `;
    } else {
      html = await res.text();
    }
    readerPage.innerHTML = html;
    readerMeta.textContent = new Date().toLocaleDateString();
  } catch (err) {
    readerPage.innerHTML = `
      <h3>${label}</h3>
      <div class="meta">Error loading content</div>
      <p>Could not load lesson content. Please try again.</p>
      <pre style="font-size:12px; white-space:pre-wrap">${String(err)}</pre>
    `;
    readerMeta.textContent = '';
  }
}

// 4) Hook Lesson 1
document.getElementById('lesson-1')?.addEventListener('click', (e) => {
  const btn  = e.currentTarget;
  const path = btn.getAttribute('data-path') || './lessons/lesson1_polish/content.html';
  loadLesson('Lesson 1 — Polish', path);
});
