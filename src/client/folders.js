// @ts-check
// Pastas das telas: em que pasta cada tela esta, a cor de cada pasta e os gestos
// que reorganizam isso pelo navegador.
//
// A pasta de uma tela comeca sendo a pasta real do arquivo. O usuario pode
// move-la para outra — inclusive uma criada por ele —, e isso **so existe no
// navegador**: nenhum arquivo muda de lugar no disco. Olhar continua nao mudando
// o que esta sendo olhado.
//
// O estado mora em `state.js` (`folders`), e quem muda avisa por
// `notifyFoldersChange`; `board.js` liga isso a sidebar e ao layout. Este modulo
// nao conhece nenhum dos dois.

import { collapsedDirs, folders, notifyFoldersChange, screens } from './state.js';
import { loadFolders, saveFolders } from './storage.js';
import { basenameOf, dirnameOf, folderColor, relocatePath, sortNames } from './utils.js';

/** Nome de partida de uma pasta criada pelo usuario. */
const NEW_FOLDER_NAME = 'nova pasta';

/** Distancia minima, em graus, entre o matiz sorteado e os que ja existem. */
const MIN_HUE_DISTANCE = 28;

/** Tentativas de sorteio antes de aceitar um matiz perto de outro. */
const HUE_TRIES = 12;

/**
 * Troca o conteudo de um registro sem trocar o objeto (outros modulos guardam
 * a referencia).
 * @template T
 * @param {Record<string, T>} target
 * @param {Record<string, T>} source
 */
function replaceRecord(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

/** Le a organizacao gravada deste board. Chame depois de `source.root` existir. */
export function initFolders() {
  const record = loadFolders();
  folders.overrides = new Map(Object.entries(record.overrides));
  folders.extra = new Set(record.extra);
  replaceRecord(folders.hues, record.hues);
  replaceRecord(folders.colors, record.colors);
  replaceRecord(folders.origins, record.origins);
  replaceRecord(folders.lastMoved, record.lastMoved);
}

function persist() {
  saveFolders({
    overrides: Object.fromEntries(folders.overrides),
    extra: [...folders.extra],
    hues: folders.hues,
    colors: folders.colors,
    origins: folders.origins,
    lastMoved: folders.lastMoved,
  });
}

/**
 * Lembra a tela como a ultima movida a mao da pasta dela. Chamado a cada passo
 * do arrasto, entao so grava quando muda de fato.
 * @param {string} file
 */
export function markLastMoved(file) {
  const folder = folderOf(file);
  if (!folder || folders.lastMoved[folder] === file) return;
  folders.lastMoved[folder] = file;
  persist();
}

/**
 * Poe o bloco da pasta num ponto do canvas (canto de cima, com a folga e a
 * faixa do nome). Nao avisa ninguem: quem arrastou ja chama o layout.
 * @param {string} folder
 * @param {{ x: number, y: number }} point
 */
export function setGroupOrigin(folder, point) {
  folders.origins[folder] = { x: point.x, y: point.y };
  persist();
}

/** Esquece onde o usuario pos cada bloco: e o "Reorganizar" do board. */
export function clearGroupOrigins() {
  replaceRecord(folders.origins, {});
  persist();
}

/**
 * Leva as chaves de um registro por pasta junto com a pasta movida.
 * @template T
 * @param {Record<string, T>} record
 * @param {string} from
 * @param {string} to
 */
function relocateKeys(record, from, to) {
  const moved = Object.entries(record).map(([path, value]) => [relocatePath(path, from, to), value]);
  replaceRecord(record, Object.fromEntries(moved));
}

/** Grava e avisa: a sidebar e o layout redesenham a partir do estado novo. */
function commit() {
  persist();
  notifyFoldersChange();
}

/**
 * Pasta efetiva de uma tela: a escolhida no navegador, ou a real.
 * @param {string} file
 * @returns {string} `''` para a raiz
 */
export function folderOf(file) {
  return folders.overrides.get(file) ?? dirnameOf(file);
}

/**
 * Toda pasta que existe na arvore agora, com os ancestrais.
 * @returns {Set<string>}
 */
function allFolders() {
  const out = new Set();
  const add = (/** @type {string} */ folder) => {
    for (let path = folder; path; path = dirnameOf(path)) out.add(path);
  };
  for (const file of screens.keys()) add(folderOf(file));
  for (const folder of folders.extra) add(folder);
  return out;
}

/**
 * Sorteia o matiz de uma pasta de topo que ainda nao tem um. Foge dos matizes
 * ja usados, para duas pastas vizinhas nao sairem quase da mesma cor.
 * @param {string} top
 * @returns {boolean} true se sorteou (e ha o que gravar)
 */
function ensureHue(top) {
  if (!top || top in folders.hues) return false;
  const used = Object.values(folders.hues);
  const distance = (/** @type {number} */ a, /** @type {number} */ b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  };
  let hue = Math.floor(Math.random() * 360);
  for (let i = 0; i < HUE_TRIES && used.some((u) => distance(u, hue) < MIN_HUE_DISTANCE); i += 1) {
    hue = Math.floor(Math.random() * 360);
  }
  folders.hues[top] = hue;
  return true;
}

/**
 * Cor de uma pasta, ou null para a raiz.
 * @param {string} folder
 * @returns {string | null}
 */
export function colorOf(folder) {
  if (!folder) return null;
  if (ensureHue(folder.split('/')[0])) persist();
  return folderColor(folder, folders.hues, folders.colors);
}

/**
 * Aplica (ou tira) a cor da pasta num elemento: a variavel CSS e o caminho,
 * que e por onde a cor se reacha quando muda.
 * @param {HTMLElement} el
 * @param {string} folder
 */
export function paintElement(el, folder) {
  const color = colorOf(folder);
  if (color) {
    el.style.setProperty('--folder-color', color);
    el.dataset.folderPath = folder;
  } else {
    el.style.removeProperty('--folder-color');
    delete el.dataset.folderPath;
  }
}

/**
 * Marca o card e a folha da sidebar com a cor da pasta da tela.
 * @param {import('./state.js').Screen} screen
 */
export function paintScreen(screen) {
  const folder = folderOf(screen.file);
  paintElement(screen.card, folder);
  paintElement(screen.item, folder);
  const dot = screen.card.querySelector('.card-folder-dot');
  if (dot instanceof HTMLElement) dot.title = folder;
}

/** Remarca todas as telas: depois de qualquer mudanca de pasta. */
export function paintAllScreens() {
  for (const screen of screens.values()) paintScreen(screen);
}

/** Recolore tudo que mostra cor de pasta, sem remontar nada. */
function repaintColors() {
  for (const el of document.querySelectorAll('[data-folder-path]')) {
    if (!(el instanceof HTMLElement)) continue;
    const color = colorOf(el.dataset.folderPath ?? '');
    if (color) el.style.setProperty('--folder-color', color);
  }
}

/**
 * Troca a cor de uma pasta. Chamado a cada `input` do seletor, para o usuario
 * ver a cor mudando enquanto escolhe; so recolore — remontar a sidebar tiraria
 * do DOM o proprio seletor aberto. Grava quando `save` vem ligado (`change`).
 * @param {string} folder
 * @param {string} hex
 * @param {boolean} save
 */
export function setFolderColor(folder, hex, save) {
  folders.colors[folder] = hex;
  repaintColors();
  if (save) persist();
}

/**
 * Esquece a cor escolhida: a pasta volta a sortear (topo) ou a derivar do pai.
 * @param {string} folder
 */
export function clearFolderColor(folder) {
  delete folders.colors[folder];
  repaintColors();
  persist();
}

/**
 * Poe uma tela numa pasta. A pasta real dela nao precisa de registro.
 * @param {string} file
 * @param {string} folder
 */
export function moveFileTo(file, folder) {
  if (folder === dirnameOf(file)) folders.overrides.delete(file);
  else folders.overrides.set(file, folder);
  commit();
}

/**
 * Leva uma pasta (e tudo abaixo dela) para outro caminho: e o que mover e
 * renomear tem em comum. As telas de dentro, as pastas vazias, as cores
 * escolhidas e o colapso da sidebar andam junto.
 * @param {string} from
 * @param {string} to
 * @returns {boolean} false quando o destino e a propria pasta ou esta dentro dela
 */
function relocateFolder(from, to) {
  if (!from || !to || from === to || to.startsWith(`${from}/`)) return false;

  const files = new Set([...screens.keys(), ...folders.overrides.keys()]);
  for (const file of files) {
    const current = folderOf(file);
    const moved = relocatePath(current, from, to);
    if (moved === current) continue;
    if (moved === dirnameOf(file)) folders.overrides.delete(file);
    else folders.overrides.set(file, moved);
  }

  folders.extra = new Set([...folders.extra].map((path) => relocatePath(path, from, to)));

  relocateKeys(folders.colors, from, to);
  relocateKeys(folders.origins, from, to);
  relocateKeys(folders.lastMoved, from, to);

  for (const path of [...collapsedDirs]) {
    const moved = relocatePath(path, from, to);
    if (moved !== path) {
      collapsedDirs.delete(path);
      collapsedDirs.add(moved);
    }
  }

  commit();
  return true;
}

/**
 * Poe uma pasta dentro de outra (`''` e a raiz).
 * @param {string} folder
 * @param {string} parent
 * @returns {boolean}
 */
export function moveFolderInto(folder, parent) {
  const name = basenameOf(folder);
  return relocateFolder(folder, parent ? `${parent}/${name}` : name);
}

/**
 * Renomeia uma pasta no mesmo nivel. Barra no nome vira hifen: o nome e de uma
 * pasta so, e uma barra criaria niveis que o usuario nao pediu.
 * @param {string} folder
 * @param {string} name
 * @returns {boolean}
 */
export function renameFolder(folder, name) {
  const clean = name.trim().replace(/\//g, '-');
  if (!clean) return false;
  const parent = dirnameOf(folder);
  return relocateFolder(folder, parent ? `${parent}/${clean}` : clean);
}

/**
 * Cria uma pasta vazia, com um nome que ainda nao exista naquele nivel.
 * @param {string} parent
 * @returns {string} o caminho criado
 */
export function createFolder(parent = '') {
  const taken = allFolders();
  const pathFor = (/** @type {string} */ name) => (parent ? `${parent}/${name}` : name);
  let path = pathFor(NEW_FOLDER_NAME);
  for (let n = 2; taken.has(path); n += 1) path = pathFor(`${NEW_FOLDER_NAME} ${n}`);
  folders.extra.add(path);
  commit();
  return path;
}

/**
 * Ha alguma tela nesta pasta ou abaixo dela?
 * @param {string} folder
 * @returns {boolean}
 */
export function folderHasScreens(folder) {
  for (const file of screens.keys()) {
    const current = folderOf(file);
    if (current === folder || current.startsWith(`${folder}/`)) return true;
  }
  return false;
}

/**
 * Apaga uma pasta vazia. Pasta com tela dentro nao se apaga: as telas nao tem
 * para onde ir sem uma escolha do usuario.
 * @param {string} folder
 */
export function removeFolder(folder) {
  if (folderHasScreens(folder)) return;
  for (const path of [...folders.extra]) {
    if (path === folder || path.startsWith(`${folder}/`)) folders.extra.delete(path);
  }
  commit();
}

/**
 * Volta as telas as pastas reais e esquece pastas criadas e cores escolhidas.
 * Onde cada bloco foi posto continua: isso e organizacao do canvas, e quem a
 * esquece e o "Reorganizar".
 */
export function resetFolders() {
  folders.overrides.clear();
  folders.extra.clear();
  replaceRecord(folders.colors, {});
  commit();
}

/**
 * As telas agrupadas pela pasta efetiva, com a raiz primeiro e as pastas em
 * ordem alfabetica — subpasta logo depois da pasta dela.
 * @template {{ file: string }} T
 * @param {T[]} items
 * @returns {Array<[string, T[]]>}
 */
export function groupByFolder(items) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const item of items) {
    const folder = folderOf(item.file);
    const list = groups.get(folder);
    if (list) list.push(item);
    else groups.set(folder, [item]);
  }
  return sortNames([...groups.keys()]).map((folder) => [folder, groups.get(folder) ?? []]);
}
