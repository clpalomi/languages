// Base URL for current directory (handles GitHub Pages subpaths)
export const baseURL = new URL('.', location.href).href;

// Europe/Madrid "YYYY-MM-DD"
export const todayES = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

export const qs = (sel) => document.querySelector(sel);
export const qsa = (sel) => Array.from(document.querySelectorAll(sel));
