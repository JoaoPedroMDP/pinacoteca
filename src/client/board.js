// Board da pinacoteca: monta os cards, controla zoom/pan e aplica os eventos do servidor.

const CARD_WIDTH = 1280;      // largura maxima / viewport de referencia de cada prototipo
const MIN_FRAME_WIDTH = 200;
const CARD_TITLE_HEIGHT = 36; // altura do rotulo acima do frame (linha 28px + 8px de padding)
const DEFAULT_FRAME_HEIGHT = 800;
const MIN_FRAME_HEIGHT = 400;
const MAX_FRAME_HEIGHT = 3200;
const GAP = 72;

const MIN_SCALE = 0.05;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.2;

const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const screenList = document.getElementById('screen-list');
const screenCount = document.getElementById('screen-count');
const rootPath = document.getElementById('root-path');
const connection = document.getElementById('connection');
const version = document.getElementById('version');
const zoomLabel = document.getElementById('zoom-label');
const emptyState = document.getElementById('empty-state');

/** file (caminho relativo) -> { card, iframe, item, frameHeight, x, y } */
const screens = new Map();

let scale = 1;
let translateX = 0;
let translateY = 0;
let interactiveFile = null;

// Pastas colapsadas na sidebar, por caminho de pasta. Persiste entre re-render (add/remove).
const collapsedDirs = new Set();

// 'pan' (arrasta o board, cursor de mao) ou 'pointer' (cursor normal; hover destaca elementos).
let mode = 'pan';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Cada segmento e escapado separadamente: as barras continuam sendo barras.
const encodePath = (file) => file.split('/').map(encodeURIComponent).join('/');

const previewUrl = (file) => `/preview/${encodePath(file)}?t=${Date.now()}`;

/* ---------- Transform ---------- */

function applyTransform() {
  canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  // Contra-escala dos titulos: cada .card-title usa 1/scale para ficar sempre 16px na tela.
  canvas.style.setProperty('--inv-scale', String(1 / scale));
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}

function zoomAt(factor, clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;

  const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = nextScale / scale;

  // Mantem fixo o ponto do canvas que esta sob o cursor.
  translateX = pointerX - ratio * (pointerX - translateX);
  translateY = pointerY - ratio * (pointerY - translateY);
  scale = nextScale;

  applyTransform();
}

function zoomByStep(factor) {
  const rect = viewport.getBoundingClientRect();
  zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function contentBounds() {
  if (screens.size === 0) return null;

  let maxX = 0;
  let maxY = 0;
  for (const screen of screens.values()) {
    maxX = Math.max(maxX, screen.x + screen.frameWidth);
    maxY = Math.max(maxY, screen.y + CARD_TITLE_HEIGHT + screen.frameHeight);
  }
  return { width: maxX, height: maxY };
}

function fitToScreen() {
  const bounds = contentBounds();
  if (!bounds) return;

  const padding = 64;
  const available = viewport.getBoundingClientRect();
  const fitScale = Math.min(
    (available.width - padding * 2) / bounds.width,
    (available.height - padding * 2) / bounds.height,
    1,
  );

  scale = clamp(fitScale, MIN_SCALE, MAX_SCALE);
  translateX = (available.width - bounds.width * scale) / 2;
  translateY = (available.height - bounds.height * scale) / 2;
  applyTransform();
}

function centerOn(file) {
  const screen = screens.get(file);
  if (!screen) return;

  const available = viewport.getBoundingClientRect();
  const cardHeight = CARD_TITLE_HEIGHT + screen.frameHeight;

  // Enquadra o card inteiro, sem passar de 100%.
  scale = clamp(
    Math.min((available.width - 96) / screen.frameWidth, (available.height - 96) / cardHeight),
    MIN_SCALE,
    1,
  );
  translateX = available.width / 2 - (screen.x + screen.frameWidth / 2) * scale;
  translateY = available.height / 2 - (screen.y + cardHeight / 2) * scale;

  applyTransform();
  setCurrent(file);
}

function setCurrent(file) {
  for (const [key, screen] of screens) {
    screen.item.setAttribute('aria-current', String(key === file));
  }
}

/* ---------- Layout ---------- */

// Distribuicao em colunas: cada card vai para a coluna mais curta no momento.
function layout() {
  const files = [...screens.keys()].sort((a, b) => a.localeCompare(b));
  const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)));
  const columnHeights = new Array(columns).fill(0);

  // Coluna dimensionada ao card mais largo: cards estreitos (mobile) ficam
  // encostados em vez de espalhados por slots de 1280px.
  let columnWidth = MIN_FRAME_WIDTH;
  for (const screen of screens.values()) columnWidth = Math.max(columnWidth, screen.frameWidth);

  for (const file of files) {
    const screen = screens.get(file);
    let target = 0;
    for (let i = 1; i < columns; i += 1) {
      if (columnHeights[i] < columnHeights[target]) target = i;
    }

    screen.x = target * (columnWidth + GAP);
    screen.y = columnHeights[target];
    screen.card.style.left = `${screen.x}px`;
    screen.card.style.top = `${screen.y}px`;

    columnHeights[target] += CARD_TITLE_HEIGHT + screen.frameHeight + GAP;
  }
}

/* ---------- Cards ---------- */

function measureFrameHeight(iframe) {
  // Mesma origem (tudo sai do localhost), entao da para medir o conteudo real.
  try {
    const doc = iframe.contentDocument;
    if (!doc) return null;
    const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    return height > 0 ? clamp(height, MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT) : null;
  } catch {
    return null;
  }
}

/*
 * Largura real da tela, para o card nao ficar bem mais largo que o prototipo.
 * E a caixa tida em volta dos elementos do topo do body (direita menos esquerda),
 * nao so a borda direita: um prototipo mobile centralizado numa viewport de 1280px
 * tem margem vazia dos dois lados, e so a diferenca da a largura da tela em si.
 * Como encolher o card reflui e recentra o conteudo, a margem some na proxima carga.
 */
function measureFrameWidth(iframe) {
  try {
    const doc = iframe.contentDocument;
    const body = doc?.body;
    if (!body) return null;

    let left = Infinity;
    let right = 0;
    for (const el of body.children) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    if (right <= left) return null;
    return clamp(Math.ceil(right - left), MIN_FRAME_WIDTH, CARD_WIDTH);
  } catch {
    return null;
  }
}

/**
 * Le do proprio iframe os recursos que ele de fato buscou.
 * E a verdade do que a tela usa: pega @import encadeado, imagem vinda do CSS
 * e asset injetado por JS — nada disso sairia de um parser de HTML.
 */
function collectAssets(screen, into = new Set()) {
  try {
    const win = screen.iframe.contentWindow;
    if (!win?.performance) return into;

    const prefix = `${location.origin}/preview/`;
    for (const entry of win.performance.getEntriesByType('resource')) {
      if (!entry.name.startsWith(prefix)) continue;

      const relative = entry.name.slice(prefix.length).split(/[?#]/)[0];
      try {
        into.add(decodeURIComponent(relative));
      } catch {
        into.add(relative);
      }
    }
  } catch {
    // Iframe ainda nao navegou ou o acesso falhou: mantem o que ja tinha.
  }
  return into;
}

function createCard(file) {
  const card = document.createElement('article');
  card.className = 'card';
  card.style.width = `${CARD_WIDTH}px`; // largura inicial; ajustada ao conteudo no load

  const title = document.createElement('header');
  title.className = 'card-title';
  title.textContent = file;

  const frame = document.createElement('div');
  frame.className = 'card-frame';
  frame.style.height = `${DEFAULT_FRAME_HEIGHT}px`;

  const iframe = document.createElement('iframe');
  iframe.src = previewUrl(file);
  iframe.title = file;

  const shield = document.createElement('div');
  shield.className = 'card-shield';
  shield.addEventListener('dblclick', () => setInteractive(file));
  // Alt+clique captura o elemento sob o cursor e copia o XPath dele.
  shield.addEventListener('click', (event) => {
    if (event.altKey) copyXPathAt(file, event);
  });
  // No modo ponteiro, passar o mouse destaca o elemento sob o cursor.
  shield.addEventListener('pointermove', (event) => onInspectMove(file, event));
  shield.addEventListener('pointerleave', () => {
    if (mode === 'pointer') clearHoverHighlight();
  });

  frame.append(iframe, shield);
  card.append(title, frame);

  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'screen-item';
  item.title = file;
  // Na arvore o caminho da pasta ja vem do cabecalho; a folha mostra so o nome do arquivo.
  item.textContent = file.slice(file.lastIndexOf('/') + 1);
  item.addEventListener('click', () => centerOn(file));

  const screen = {
    file, card, frame, iframe, item, assets: new Set(),
    frameWidth: CARD_WIDTH, frameHeight: DEFAULT_FRAME_HEIGHT, x: 0, y: 0,
  };

  iframe.addEventListener('load', () => {
    // Recalculado a cada carga: o map nunca fica velho.
    screen.assets = collectAssets(screen);
    // Estilo do destaque some quando o iframe recarrega; reinjeta.
    injectInspectStyle(iframe.contentDocument);
    // Segunda passada para os recursos que chegam depois do load (JS tardio,
    // imagem pedida por CSS que so entrou agora).
    clearTimeout(screen.lateScan);
    screen.lateScan = setTimeout(() => collectAssets(screen, screen.assets), 1200);

    if (screen.pendingScroll) {
      // Restaura o scroll interno depois de um recarregamento.
      iframe.contentWindow?.scrollTo(0, screen.pendingScroll);
      screen.pendingScroll = 0;
    }

    let dirty = false;

    // Largura primeiro: encolher o card reflui o conteudo, e a altura tem de
    // ser medida ja com essa largura para nao ficar desatualizada.
    const width = measureFrameWidth(iframe);
    if (width && Math.abs(width - screen.frameWidth) > 1) {
      screen.frameWidth = width;
      screen.card.style.width = `${width}px`;
      dirty = true;
    }

    const measured = measureFrameHeight(iframe);
    if (measured && Math.abs(measured - screen.frameHeight) > 1) {
      screen.frameHeight = measured;
      screen.frame.style.height = `${measured}px`;
      dirty = true;
    }

    if (dirty) layout();
  });

  screens.set(file, screen);
  canvas.append(card);
  return screen;
}

function removeCard(file) {
  const screen = screens.get(file);
  if (!screen) return;

  if (interactiveFile === file) interactiveFile = null;
  clearTimeout(screen.lateScan);
  screen.card.remove();
  screen.item.remove();
  screens.delete(file);
}

function reloadCard(file) {
  const screen = screens.get(file);
  if (!screen) return;

  try {
    screen.pendingScroll = screen.iframe.contentWindow?.scrollY ?? 0;
  } catch {
    screen.pendingScroll = 0;
  }

  screen.iframe.src = previewUrl(file);

  screen.item.classList.remove('is-updated');
  // Reinicia a animacao: sem o reflow o navegador ignora a reaplicacao da classe.
  void screen.item.offsetWidth;
  screen.item.classList.add('is-updated');
}

// Monta uma arvore de pastas a partir dos caminhos relativos das telas.
function buildTree(files) {
  const root = { path: '', dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      if (!node.dirs.has(name)) {
        node.dirs.set(name, {
          path: node.path ? `${node.path}/${name}` : name,
          dirs: new Map(),
          files: [],
        });
      }
      node = node.dirs.get(name);
    }
    node.files.push(file);
  }
  return root;
}

function folderElement(name, node) {
  const wrap = document.createElement('div');
  wrap.className = 'tree-folder';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'folder-toggle';
  const collapsed = collapsedDirs.has(node.path);
  toggle.setAttribute('aria-expanded', String(!collapsed));

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▸';
  const label = document.createElement('span');
  label.className = 'folder-name';
  label.textContent = name;
  toggle.append(caret, label);
  toggle.addEventListener('click', () => {
    if (collapsedDirs.has(node.path)) collapsedDirs.delete(node.path);
    else collapsedDirs.add(node.path);
    renderSidebar();
  });

  const children = document.createElement('div');
  children.className = 'folder-children';
  children.hidden = collapsed;
  children.append(...renderNodes(node));

  wrap.append(toggle, children);
  return wrap;
}

// Pastas primeiro (em ordem), depois os arquivos daquele nivel.
function renderNodes(node) {
  const out = [];
  const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of dirNames) out.push(folderElement(name, node.dirs.get(name)));
  const files = [...node.files].sort((a, b) => a.localeCompare(b));
  for (const file of files) out.push(screens.get(file).item);
  return out;
}

function renderSidebar() {
  const files = [...screens.keys()].sort((a, b) => a.localeCompare(b));
  screenList.replaceChildren(...renderNodes(buildTree(files)));
  screenCount.textContent = String(files.length);
  emptyState.hidden = files.length > 0;
}

/* ---------- Modo de interacao ---------- */

function setInteractive(file) {
  if (interactiveFile === file) return;

  if (interactiveFile) screens.get(interactiveFile)?.card.classList.remove('is-interactive');
  interactiveFile = file;

  if (file) {
    screens.get(file)?.card.classList.add('is-interactive');
    setCurrent(file);
  }
}

/* ---------- Captura de XPath ---------- */

// XPath absoluto do elemento; usa @id quando existe (mais curto e estavel).
function computeXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;

  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    let index = 1;
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.nodeName === node.nodeName) index += 1;
    }
    parts.unshift(`${node.nodeName.toLowerCase()}[${index}]`);
    if (node.nodeName === 'HTML') break;
    node = node.parentElement;
  }
  return `/${parts.join('/')}`;
}

// Mesma origem: da para ler o elemento sob o cursor dentro do iframe.
// As coordenadas do board estao escaladas por `scale`, entao dividimos para voltar
// ao espaco interno do iframe antes de chamar elementFromPoint.
function copyXPathAt(file, event) {
  const screen = screens.get(file);
  if (!screen) return;

  let el = null;
  try {
    const rect = screen.iframe.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    el = screen.iframe.contentDocument?.elementFromPoint(x, y) ?? null;
  } catch {
    el = null;
  }
  if (!el) return;

  const xpath = computeXPath(el);
  copyText(xpath);
  showToast(`XPath copiado — ${xpath}`);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

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

let toastTimer = null;
function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

/* ---------- Modo ponteiro (destaque no hover) ---------- */

// Injetado dentro de cada iframe (mesma origem). Os elementos "de fora" do foco
// recebem .pina-dim: leve blur + escurecida, opacidade 80%.
const INSPECT_CSS =
  '.pina-dim{filter:blur(1.5px)!important;transition:filter .12s ease;}'
  + '.pina-focus{outline:2px solid #6ea8fe!important;outline-offset:1px!important;}';

function injectInspectStyle(doc) {
  try {
    if (!doc || doc.getElementById('pina-inspect-style')) return;
    const style = doc.createElement('style');
    style.id = 'pina-inspect-style';
    style.textContent = INSPECT_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  } catch {
    // Iframe cross-origin ou ainda sem documento: ignora.
  }
}

// Estado do destaque. `hoverBase` e o elemento exato mais fundo sob o cursor;
// `inspectLevel` sobe pela cadeia de ancestrais (scroll do mouse) e `hoverEl` e o
// alvo resultante (base subida `inspectLevel` niveis).
let hoverScreen = null;
let hoverBase = null;
let hoverEl = null;
let inspectLevel = 0;
// Scroll acumulado: so muda o nivel a cada WHEEL_STEP px. Segura o touchpad,
// que dispara muitos deltas pequenos e antes trocava o nivel a cada toque.
let wheelAccum = 0;
const WHEEL_STEP = 100;

function clearHoverHighlight() {
  if (hoverScreen) {
    try {
      hoverScreen.iframe.contentDocument
        ?.querySelectorAll('.pina-dim, .pina-focus')
        .forEach((el) => el.classList.remove('pina-dim', 'pina-focus'));
    } catch { /* iframe trocou de src no meio: nada a limpar */ }
  }
  hoverScreen = null;
  hoverBase = null;
  hoverEl = null;
  inspectLevel = 0;
  wheelAccum = 0;
  hideInspectTip();
}

// Quantos ancestrais existem entre a base e o <body> — teto do nivel de scroll.
function maxLevelFor(base) {
  let count = 0;
  let node = base;
  while (node.parentElement && node.nodeName !== 'BODY') {
    node = node.parentElement;
    count += 1;
  }
  return count;
}

// Alvo = base subindo `level` ancestrais, sem passar do <body>.
function targetFromBase(base, level) {
  let node = base;
  for (let i = 0; i < level && node.parentElement && node.nodeName !== 'BODY'; i += 1) {
    node = node.parentElement;
  }
  return node;
}

// (Re)aplica o dim para o alvo do nivel atual e move o tooltip para o cursor.
function applyHover(doc, clientX, clientY) {
  try {
    doc.querySelectorAll('.pina-dim, .pina-focus')
      .forEach((el) => el.classList.remove('pina-dim', 'pina-focus'));
  } catch { /* iframe trocou de src: nada a limpar */ }
  const target = targetFromBase(hoverBase, inspectLevel);
  dimOthers(doc, target);
  target.classList.add('pina-focus');
  hoverEl = target;
  showInspectTip(target, clientX, clientY);
}

// Escurece tudo que nao esta no ramo do elemento sob o cursor: para cada ancestral,
// os irmaos fora do caminho ganham .pina-dim. O elemento e seus filhos ficam nitidos.
function dimOthers(doc, el) {
  const root = doc.documentElement;
  let node = el;
  while (node && node.parentElement) {
    const parent = node.parentElement;
    for (const child of parent.children) {
      if (child === node) continue;
      if (child.nodeName === 'STYLE' || child.nodeName === 'SCRIPT') continue;
      child.classList.add('pina-dim');
    }
    if (parent === root) break;
    node = parent;
  }
}

function onInspectMove(file, event) {
  if (mode !== 'pointer') return;
  const screen = screens.get(file);
  if (!screen) return;

  let base = null;
  let doc = null;
  try {
    doc = screen.iframe.contentDocument;
    const rect = screen.iframe.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    base = doc?.elementFromPoint(x, y) ?? null;
  } catch {
    base = null;
  }
  if (!base || !doc) {
    clearHoverHighlight();
    return;
  }

  // Mesma base: so acompanha o cursor com o tooltip, mantendo o nivel de scroll.
  if (base === hoverBase && screen === hoverScreen) {
    showInspectTip(hoverEl, event.clientX, event.clientY);
    return;
  }

  // Base nova: reinicia no elemento exato (nivel 0).
  clearHoverHighlight();
  injectInspectStyle(doc);
  hoverScreen = screen;
  hoverBase = base;
  inspectLevel = 0;
  applyHover(doc, event.clientX, event.clientY);
}

// Scroll do mouse no modo ponteiro: +1 sobe um ancestral, -1 volta pro filho.
function adjustInspectLevel(delta, clientX, clientY) {
  if (!hoverScreen || !hoverBase) return;
  const doc = hoverScreen.iframe.contentDocument;
  if (!doc) return;
  inspectLevel = clamp(inspectLevel + delta, 0, maxLevelFor(hoverBase));
  applyHover(doc, clientX, clientY);
}

/* ---------- Tooltip do modo ponteiro ---------- */

// Descreve o alvo de forma curta: tag + #id ou .classe (ignora .pina-dim).
function describeEl(el) {
  let text = el.nodeName.toLowerCase();
  if (el.id) {
    text += `#${el.id}`;
  } else {
    const cls = [...el.classList].find((c) => c !== 'pina-dim' && c !== 'pina-focus');
    if (cls) text += `.${cls}`;
  }
  return text;
}

function showInspectTip(el, clientX, clientY) {
  if (!el) return;
  let tip = document.getElementById('inspect-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'inspect-tip';
    tip.className = 'inspect-tip';
    document.body.append(tip);
  }
  tip.textContent = `${describeEl(el)} · scroll: muda o nivel`;
  tip.style.left = `${clientX + 14}px`;
  tip.style.top = `${clientY + 14}px`;
  tip.classList.add('is-visible');
}

function hideInspectTip() {
  document.getElementById('inspect-tip')?.classList.remove('is-visible');
}

function setMode(next) {
  mode = next;
  viewport.classList.toggle('is-pointer', mode === 'pointer');
  if (mode !== 'pointer') clearHoverHighlight();
  const button = document.querySelector('[data-action="toggle-mode"]');
  if (button) button.setAttribute('aria-pressed', String(mode === 'pointer'));
}

/* ---------- Pan e zoom ---------- */

viewport.addEventListener('wheel', (event) => {
  // No modo ponteiro sobre um card, o scroll muda o nivel do destaque (nao zoom/pan).
  if (mode === 'pointer' && hoverScreen) {
    event.preventDefault();
    // Troca de direcao zera o acumulado: nao "gasta" scroll do sentido anterior.
    if ((wheelAccum < 0) !== (event.deltaY < 0)) wheelAccum = 0;
    wheelAccum += event.deltaY;
    while (Math.abs(wheelAccum) >= WHEEL_STEP) {
      // Scroll pra cima (deltaY < 0) sobe um ancestral; pra baixo volta pro filho.
      adjustInspectLevel(wheelAccum < 0 ? 1 : -1, event.clientX, event.clientY);
      wheelAccum -= Math.sign(wheelAccum) * WHEEL_STEP;
    }
    return;
  }

  // Sobre um card em modo de interacao o scroll pertence ao prototipo.
  if (interactiveFile && event.target.closest?.('.card.is-interactive')) return;

  event.preventDefault();

  if (event.ctrlKey || event.metaKey) {
    zoomAt(Math.exp(-event.deltaY / 200), event.clientX, event.clientY);
  } else {
    translateX -= event.deltaX;
    translateY -= event.deltaY;
    applyTransform();
  }
}, { passive: false });

let panPointerId = null;
let panStartX = 0;
let panStartY = 0;

viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  // Alt+clique e captura de XPath, nao pan: deixa o evento chegar ao escudo.
  if (event.altKey) return;
  // No modo ponteiro o arrasto com botao esquerdo nao move o board (o do meio ainda move).
  if (mode === 'pointer' && event.button === 0) return;
  if (interactiveFile && event.target.closest?.('.card.is-interactive')) return;
  // A toolbar fica dentro do viewport: sem isso o setPointerCapture abaixo
  // redirecionaria o clique para o viewport e os botoes nunca disparariam.
  if (event.target.closest?.('.toolbar')) return;

  panPointerId = event.pointerId;
  panStartX = event.clientX - translateX;
  panStartY = event.clientY - translateY;
  viewport.classList.add('is-panning');
  viewport.setPointerCapture(event.pointerId);
});

viewport.addEventListener('pointermove', (event) => {
  if (event.pointerId !== panPointerId) return;
  translateX = event.clientX - panStartX;
  translateY = event.clientY - panStartY;
  applyTransform();
});

function endPan(event) {
  if (event.pointerId !== panPointerId) return;
  panPointerId = null;
  viewport.classList.remove('is-panning');
}

viewport.addEventListener('pointerup', endPan);
viewport.addEventListener('pointercancel', endPan);

// Clique no vazio sai do modo de interacao.
viewport.addEventListener('click', (event) => {
  if (interactiveFile && !event.target.closest?.('.card.is-interactive')) setInteractive(null);
});

document.querySelector('.toolbar').addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  if (action === 'zoom-in') zoomByStep(ZOOM_STEP);
  else if (action === 'zoom-out') zoomByStep(1 / ZOOM_STEP);
  else if (action === 'zoom-reset') { scale = 1; applyTransform(); }
  else if (action === 'fit') fitToScreen();
  else if (action === 'toggle-mode') setMode(mode === 'pointer' ? 'pan' : 'pointer');
});

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Escape') setInteractive(null);
  else if (event.key === '0') fitToScreen();
  else if (event.key === '1') { scale = 1; applyTransform(); }
  else if (event.key === '+' || event.key === '=') zoomByStep(ZOOM_STEP);
  else if (event.key === '-') zoomByStep(1 / ZOOM_STEP);
});

/* ---------- Carga inicial e eventos do servidor ---------- */

async function loadScreens() {
  const response = await fetch('/api/screens');
  const data = await response.json();

  rootPath.textContent = data.root;
  rootPath.title = data.root;
  if (data.version) version.textContent = `v${data.version}`;

  for (const file of data.screens) createCard(file);
  renderSidebar();
  layout();
  fitToScreen();
}

function connectEvents() {
  const source = new EventSource('/events');

  source.addEventListener('open', () => {
    connection.dataset.state = 'live';
    connection.textContent = 'ao vivo';
  });

  source.addEventListener('error', () => {
    // O EventSource reconecta sozinho; so refletimos o estado.
    connection.dataset.state = 'offline';
    connection.textContent = 'reconectando';
  });

  source.addEventListener('message', (event) => {
    const { type, file } = JSON.parse(event.data);

    if (type === 'change') {
      // Um 'change' em arquivo que ainda nao existe no board equivale a um 'add'.
      if (screens.has(file)) reloadCard(file);
      else { createCard(file); renderSidebar(); layout(); centerOn(file); }
    } else if (type === 'add') {
      if (!screens.has(file)) {
        createCard(file);
        renderSidebar();
        layout();
        // Tela recem-detectada ganha o foco: enquadra e centraliza nela.
        centerOn(file);
      }
    } else if (type === 'unlink') {
      removeCard(file);
      renderSidebar();
      layout();
    } else if (type === 'asset') {
      // Recarrega so as telas que carregaram esse recurso.
      for (const [screenFile, screen] of screens) {
        if (screen.assets.has(file)) reloadCard(screenFile);
      }
    }
  });
}

applyTransform();
loadScreens().then(connectEvents);
