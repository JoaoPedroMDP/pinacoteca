// Board da pinacoteca: monta os cards, controla zoom/pan e aplica os eventos do servidor.

const CARD_WIDTH = 1280;      // viewport de referencia de cada prototipo
const CARD_TITLE_HEIGHT = 28; // altura do rotulo acima do frame
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
const zoomLabel = document.getElementById('zoom-label');
const emptyState = document.getElementById('empty-state');

/** file (caminho relativo) -> { card, iframe, item, frameHeight, x, y } */
const screens = new Map();

let scale = 1;
let translateX = 0;
let translateY = 0;
let interactiveFile = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Cada segmento e escapado separadamente: as barras continuam sendo barras.
const encodePath = (file) => file.split('/').map(encodeURIComponent).join('/');

const previewUrl = (file) => `/preview/${encodePath(file)}?t=${Date.now()}`;

/* ---------- Transform ---------- */

function applyTransform() {
  canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
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
    maxX = Math.max(maxX, screen.x + CARD_WIDTH);
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
    Math.min((available.width - 96) / CARD_WIDTH, (available.height - 96) / cardHeight),
    MIN_SCALE,
    1,
  );
  translateX = available.width / 2 - (screen.x + CARD_WIDTH / 2) * scale;
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

  for (const file of files) {
    const screen = screens.get(file);
    let target = 0;
    for (let i = 1; i < columns; i += 1) {
      if (columnHeights[i] < columnHeights[target]) target = i;
    }

    screen.x = target * (CARD_WIDTH + GAP);
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
  card.style.width = `${CARD_WIDTH}px`;

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

  frame.append(iframe, shield);
  card.append(title, frame);

  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'screen-item';
  item.title = file;
  const slash = file.lastIndexOf('/');
  if (slash === -1) {
    item.textContent = file;
  } else {
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = `${file.slice(0, slash + 1)}`;
    item.append(dir, document.createTextNode(file.slice(slash + 1)));
  }
  item.addEventListener('click', () => centerOn(file));

  const screen = {
    file, card, frame, iframe, item, assets: new Set(),
    frameHeight: DEFAULT_FRAME_HEIGHT, x: 0, y: 0,
  };

  iframe.addEventListener('load', () => {
    // Recalculado a cada carga: o map nunca fica velho.
    screen.assets = collectAssets(screen);
    // Segunda passada para os recursos que chegam depois do load (JS tardio,
    // imagem pedida por CSS que so entrou agora).
    clearTimeout(screen.lateScan);
    screen.lateScan = setTimeout(() => collectAssets(screen, screen.assets), 1200);

    if (screen.pendingScroll) {
      // Restaura o scroll interno depois de um recarregamento.
      iframe.contentWindow?.scrollTo(0, screen.pendingScroll);
      screen.pendingScroll = 0;
    }

    const measured = measureFrameHeight(iframe);
    if (measured && Math.abs(measured - screen.frameHeight) > 1) {
      screen.frameHeight = measured;
      screen.frame.style.height = `${measured}px`;
      layout();
    }
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

function renderSidebar() {
  const files = [...screens.keys()].sort((a, b) => a.localeCompare(b));
  screenList.replaceChildren(...files.map((file) => screens.get(file).item));
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

/* ---------- Pan e zoom ---------- */

viewport.addEventListener('wheel', (event) => {
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
  if (interactiveFile && event.target.closest?.('.card.is-interactive')) return;

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
      else { createCard(file); renderSidebar(); layout(); }
    } else if (type === 'add') {
      if (!screens.has(file)) {
        createCard(file);
        renderSidebar();
        layout();
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
