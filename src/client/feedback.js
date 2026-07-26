// @ts-check
// Avisos ao usuario: copiar para a area de transferencia e o toast que confirma.

import { ensureFloating } from './dom.js';
import { TOAST_MS } from './constants.js';

/**
 * Copia sem depender da Clipboard API, que exige contexto seguro e permissao.
 * @param {string} text
 */
function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try { document.execCommand('copy'); } catch { /* sem clipboard disponivel */ }
  area.remove();
}

/** @param {string} text */
export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let toastTimer = null;

/** @param {string} message */
export function showToast(message) {
  const toast = ensureFloating('toast', 'toast');
  toast.textContent = message;
  toast.classList.add('is-visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), TOAST_MS);
}
