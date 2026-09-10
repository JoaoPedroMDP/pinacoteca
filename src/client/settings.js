// @ts-check
// Modal de Configuracoes: abertura/fechamento, navegacao por categorias
// (General, Models) e subcategorias de modelo (por ora, so Claude), e o
// campo de chave de API que vive dentro da subcategoria Claude.
//
// Sem fold: diferente do painel antigo da aba Conversa, o campo de chave
// aqui e sempre visivel quando a subcategoria Claude esta selecionada — a
// unica visibilidade condicional que resta e a do aviso de sessao de
// ambiente, puramente informativo.

import {
  chatCredentialNote, chatKeyInput, chatKeySave, settingsClose, settingsDialog,
  settingsModelPanelClaude, settingsNav, settingsOpen, settingsPanelGeneral, settingsPanelModels,
} from './dom.js';
import { chat } from './state.js';
import { showToast } from './feedback.js';

/** @typedef {'general' | 'models'} SettingsCategory */
/** @typedef {'claude'} ModelCategory */

const keyInput = /** @type {HTMLInputElement} */ (chatKeyInput);

/** @type {Record<SettingsCategory, HTMLElement>} */
const CATEGORY_PANELS = { general: settingsPanelGeneral, models: settingsPanelModels };

/** Um painel por subcategoria de modelo. So Claude por ora — adicionar um
 * modelo novo e so acrescentar uma entrada aqui e no markup.
 * @type {Record<ModelCategory, HTMLElement>} */
const MODEL_CATEGORY_PANELS = { claude: settingsModelPanelClaude };

/**
 * Mostra a categoria `name` e esconde a outra, no painel e no botao da nav.
 * @param {SettingsCategory} name
 */
function showCategory(name) {
  for (const [category, panel] of Object.entries(CATEGORY_PANELS)) {
    const active = category === name;
    panel.hidden = !active;

    const button = settingsNav.querySelector(`[data-category="${category}"]`);
    button?.setAttribute('aria-selected', String(active));
  }
}

/**
 * Mostra a subcategoria de modelo `name` e esconde as demais.
 * @param {ModelCategory} name
 */
function showModelCategory(name) {
  for (const [category, panel] of Object.entries(MODEL_CATEGORY_PANELS)) {
    const active = category === name;
    panel.hidden = !active;

    const button = settingsNav.querySelector(`[data-model-category="${category}"]`);
    button?.setAttribute('aria-selected', String(active));
  }
}

/**
 * Abre a modal sempre na categoria General — sem estado salvo entre
 * aberturas (veja design.md - Decisions).
 */
export function openSettings() {
  showCategory('general');
  showModelCategory('claude');
  /** @type {HTMLDialogElement} */ (settingsDialog).showModal();
}

export function closeSettings() {
  /** @type {HTMLDialogElement} */ (settingsDialog).close();
}

/* ---------- Chave de API (subcategoria Claude) ---------- */

/**
 * Ha chave gravada no servidor? So informa a subcategoria Claude — nao ha
 * mais nada a esconder: o campo continua visivel mesmo com chave gravada,
 * para o usuario poder substitui-la.
 * @param {boolean} hasKey
 */
export function setHasKey(hasKey) {
  chat.hasKey = hasKey;
}

/**
 * Ha sessao do Claude Code no ambiente do servidor (`claude login`, plano
 * Pro/Max)? So controla o aviso, que e puramente informativo — sem fold, o
 * campo de chave nao reage a isso.
 * @param {boolean} hasAmbientCredential
 */
export function setHasAmbientCredential(hasAmbientCredential) {
  chat.hasAmbientCredential = hasAmbientCredential;
  chatCredentialNote.hidden = !hasAmbientCredential;
  chatCredentialNote.textContent = hasAmbientCredential
    ? 'Sessao do Claude Code detectada — a conversa ja funciona com o seu plano, sem colar chave.'
    : '';
}

/* ---------- Ligacao ---------- */

function bindNav() {
  settingsNav.addEventListener('click', (event) => {
    const target = /** @type {Element | null} */ (event.target);

    const categoryButton = target?.closest('[data-category]');
    const category = /** @type {SettingsCategory | null | undefined} */ (
      categoryButton?.getAttribute('data-category')
    );
    if (category) {
      showCategory(category);
      return;
    }

    const modelButton = target?.closest('[data-model-category]');
    const modelCategory = /** @type {ModelCategory | null | undefined} */ (
      modelButton?.getAttribute('data-model-category')
    );
    if (modelCategory) showModelCategory(modelCategory);
  });
}

function bindDialog() {
  settingsOpen.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);

  // Clique fora do conteudo: o alvo do clique e o proprio `<dialog>` so
  // quando o clique caiu no `::backdrop`, nunca dentro do conteudo.
  settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) closeSettings();
  });
}

function bindKey() {
  chatKeySave.addEventListener('click', () => {
    const value = keyInput.value.trim();
    if (!value) {
      showToast('Cole a chave antes de salvar.');
      return;
    }

    const saveKey = chat.transport?.saveKey;
    if (!saveKey) {
      showToast('A conversa ainda nao esta ligada ao servidor.');
      return;
    }

    saveKey(value);
    keyInput.value = '';
  });
}

/**
 * Registra os listeners da modal. Chamada uma vez por `board.js`, junto de
 * `initChat`.
 */
export function initSettings() {
  bindDialog();
  bindNav();
  bindKey();
}
