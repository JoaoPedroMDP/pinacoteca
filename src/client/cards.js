// @ts-check
// Cards do board: criacao, remocao, recarga e medida do conteudo real.
//
// Cada card e um titulo + um iframe + um escudo transparente por cima. O escudo
// existe porque um iframe engole scroll e arrasto: sem ele, passar o mouse sobre
// um card mataria o pan e o zoom do board.

import { canvas } from './dom.js';
import { screens, ui } from './state.js';
import { clamp, previewUrl, resizeZoneAt } from './utils.js';
import {
  applyPresetSize, centerOn, layout, persistPositions, resizeScreen, separateCollisions,
} from './view.js';
import { setCurrent } from './sidebar.js';
import {
  clearHoverHighlight, copyXPathAt, injectInspectStyle, onInspectMove, tryReanchor,
} from './inspect.js';
// Ciclo com `controls.js` (ele importa `setInteractive` daqui). E seguro: nenhum
// dos dois chama o outro durante a avaliacao do modulo, so dentro de listener.
import { bindFrameKeys } from './controls.js';
import { savedPosition } from './storage.js';
import {
  CARD_WIDTH, DEFAULT_FRAME_HEIGHT, LATE_ASSET_SCAN_MS,
  MAX_FRAME_HEIGHT, MIN_FRAME_HEIGHT, MIN_FRAME_WIDTH,
  PRESET_FRAME_SIZES, RESIZE_CURSORS, RESIZE_EDGE_PX,
} from './constants.js';

/** @typedef {import('./state.js').Screen} Screen */

/**
 * Altura real do conteudo. Mesma origem (tudo sai do localhost), entao da para
 * medir. Sem isso, uma landing page longa apareceria cortada dentro de uma
 * janelinha — o oposto do que se quer ver num board.
 *
 * @param {HTMLIFrameElement} iframe
 * @returns {number | null} null quando nao deu para medir
 */
function measureFrameHeight(iframe) {
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
 * Largura real da tela, para o card nao ficar bem mais largo que o prototipo.
 *
 * E a caixa em volta dos elementos do topo do body (direita do mais a direita
 * menos esquerda do mais a esquerda), nao o `scrollWidth` nem so a borda
 * direita: um prototipo mobile centralizado numa viewport de 1280px tem margem
 * vazia dos dois lados, e so a diferenca da a largura da tela em si. Como
 * encolher o card reflui e recentra o conteudo, a margem some na proxima carga.
 *
 * @param {HTMLIFrameElement} iframe
 * @returns {number | null} null quando nao deu para medir
 */
function measureFrameWidth(iframe) {
  try {
    const body = iframe.contentDocument?.body;
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
 *
 * E a verdade do que a tela usa: pega cadeia de imports do CSS, imagem vinda de
 * dentro do CSS e asset injetado por JS em runtime — nada disso sairia de um
 * parser de HTML no servidor.
 *
 * @param {Screen} screen
 * @param {Set<string>} [into] conjunto a completar, para a segunda passada
 * @returns {Set<string>} caminhos relativos a raiz observada
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

/**
 * Ajusta o card ao conteudo recem-carregado.
 *
 * A largura e sempre medida com o card devolvido a `CARD_WIDTH`. Medir com o
 * card ja encolhido faria o *proprio card* virar a viewport do prototipo: um
 * layout responsivo trocaria de breakpoint, seria medido mais estreito, o card
 * encolheria de novo — e a cada recarga a tela desceria mais um degrau ate o
 * `MIN_FRAME_WIDTH`, com o conteudo espremido e cortado. A viewport de
 * referencia e a mesma sempre, entao a largura medida e sempre a mesma.
 *
 * A largura vem antes da altura de proposito: mudar a largura reflui o
 * conteudo, e a altura precisa ser lida ja com a largura final.
 *
 * @param {Screen} screen
 * @returns {boolean} true quando algum tamanho mudou e o layout precisa rodar
 */
function resizeToContent(screen) {
  // Tamanho escolhido pelo usuario nao se remede sozinho: cada recarga do
  // iframe desfaria a escolha dele.
  if (screen.sized) return false;

  let changed = false;

  screen.card.style.width = `${CARD_WIDTH}px`;
  void screen.iframe.offsetWidth; // aplica a viewport antes de ler de dentro dela
  const width = measureFrameWidth(screen.iframe) ?? screen.frameWidth;

  screen.card.style.width = `${width}px`;
  if (Math.abs(width - screen.frameWidth) > 1) {
    screen.frameWidth = width;
    changed = true;
  }

  void screen.iframe.offsetWidth; // idem: a altura sai do conteudo ja refluido
  const height = measureFrameHeight(screen.iframe);
  if (height && Math.abs(height - screen.frameHeight) > 1) {
    screen.frameHeight = height;
    screen.frame.style.height = `${height}px`;
    changed = true;
  }

  return changed;
}

/**
 * Monta o titulo: o nome da tela, o botao de tamanho e o menu dele.
 *
 * Fica dentro do titulo, e nao flutuando no viewport, porque o titulo ja e
 * contra-escalado por `1/scale` — assim o botao e o menu saem do tamanho certo
 * em qualquer zoom, sem ninguem calcular posicao em px de tela.
 *
 * @param {string} file
 * @returns {HTMLElement} o `<header>` do card
 */
function buildTitle(file) {
  const title = document.createElement('header');
  title.className = 'card-title';

  const label = document.createElement('span');
  label.className = 'card-title-label';
  label.textContent = file;
  // No zoom afastado o rotulo trunca (veja `.card-title-label` em board.css); o
  // nome inteiro continua alcancavel pelo hover.
  label.title = file;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card-resize-btn';
  button.title = 'Redimensionar';
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '⤡';
  button.addEventListener('click', () => toggleSizeMenu(file));

  const menu = document.createElement('div');
  menu.className = 'card-size-menu';

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'card-size-option';
  auto.dataset.size = 'auto';
  auto.textContent = 'Automatico';
  auto.addEventListener('click', () => {
    autoSizeCard(file);
    closeSizeMenu();
  });
  menu.append(auto);

  for (const preset of PRESET_FRAME_SIZES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'card-size-option';
    option.dataset.size = `${preset.width}x${preset.height}`;
    option.textContent = `${preset.label} ${preset.width}×${preset.height}`;
    option.addEventListener('click', () => {
      applyPresetSize(file, preset.width, preset.height);
      closeSizeMenu();
    });
    menu.append(option);
  }

  title.append(label, button, menu);
  return title;
}

/**
 * Com que tamanho uma tela nasce, e se esse tamanho conta como escolha do
 * usuario (`sized`) — o que impede a medida automatica de desfaze-lo.
 *
 * A ordem e: o tamanho global desta sessao, se houver; senao o tamanho salvo;
 * senao o padrao, que a primeira medida do conteudo logo substitui. O global
 * vem na frente do salvo por ser a escolha mais recente do usuario, feita
 * justamente para valer em todas as telas.
 *
 * @param {import('./storage.js').Position | null} saved
 * @returns {{ width: number, height: number, sized: boolean }}
 */
function initialSize(saved) {
  const global = ui.globalSize;
  if (global) return { width: global.width, height: global.height, sized: true };

  if (saved?.width !== undefined && saved.height !== undefined) {
    return { width: saved.width, height: saved.height, sized: true };
  }

  return { width: CARD_WIDTH, height: DEFAULT_FRAME_HEIGHT, sized: false };
}

/**
 * Monta o card e o item de sidebar de uma tela e registra em `screens`.
 * Quem chama e responsavel por rodar `renderSidebar()` e `layout()` depois.
 *
 * @param {string} file caminho relativo da tela
 * @returns {Screen}
 */
export function createCard(file) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.file = file; // e por aqui que o arrasto sabe qual tela ele pegou

  const title = buildTitle(file);

  const frame = document.createElement('div');
  frame.className = 'card-frame';

  const iframe = document.createElement('iframe');
  iframe.src = previewUrl(file);
  iframe.title = file;

  const shield = document.createElement('div');
  shield.className = 'card-shield';
  shield.addEventListener('dblclick', () => setInteractive(file));
  shield.addEventListener('click', (event) => {
    // Ctrl+Alt+clique captura o elemento sob o cursor e copia o XPath dele.
    // Alt sozinho ja abriu a caixinha de comentario no pointerdown (controls.js).
    if (event.ctrlKey && event.altKey) copyXPathAt(file, event);
  });
  shield.addEventListener('pointermove', (event) => {
    // Perto de uma borda que agarra, o cursor ja avisa que dali sai um
    // redimensionamento — o escudo e quem recebe o ponteiro sobre o frame.
    const zone = resizeZoneAt(
      event.clientX, event.clientY, frame.getBoundingClientRect(), RESIZE_EDGE_PX,
    );
    shield.style.cursor = zone ? RESIZE_CURSORS[zone] : '';
    onInspectMove(file, event);
  });
  shield.addEventListener('pointerleave', () => {
    shield.style.cursor = '';
    if (ui.mode === 'pointer') clearHoverHighlight();
  });

  frame.append(iframe, shield);
  card.append(title, frame);

  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'screen-item';
  item.title = file;
  // Na arvore o caminho da pasta ja vem do cabecalho; a folha mostra so o nome.
  item.textContent = file.slice(file.lastIndexOf('/') + 1);
  item.addEventListener('click', () => centerOn(file));

  // A tela volta para onde — e do tamanho que — o usuario a deixou da ultima vez.
  const saved = savedPosition(file);
  const size = initialSize(saved);

  /** @type {Screen} */
  const screen = {
    file, card, frame, iframe, item,
    assets: new Set(),
    frameWidth: size.width,
    frameHeight: size.height,
    x: saved?.x ?? 0,
    y: saved?.y ?? 0,
    pinned: saved !== null,
    // Posicao salva conta como escolha do usuario: ela so existe porque ele
    // arrastou ou redimensionou a tela em alguma sessao.
    autoPinned: false,
    sized: size.sized,
    pendingScroll: 0,
    lateScan: null,
    reloadsSinceSettle: 0,
  };

  // Depois de `screen` existir, para uma tela com tamanho salvo ja nascer nele
  // em vez de piscar no tamanho padrao ate a primeira medida.
  card.style.width = `${screen.frameWidth}px`;
  frame.style.height = `${screen.frameHeight}px`;

  iframe.addEventListener('load', () => {
    // Recoletado a cada carga: o map de assets nunca fica velho.
    screen.assets = collectAssets(screen);
    // O estilo do destaque some com o documento anterior; reinjeta.
    injectInspectStyle(iframe.contentDocument);
    // Documento novo, `contentWindow` nova: o teclado precisa ser religado, senao
    // o Alt para de segurar o ponteiro assim que o foco entra na tela.
    bindFrameKeys(iframe.contentWindow);
    // Reancora (ou marca sem referencia) cada item da fila de comentarios deste arquivo.
    tryReanchor(file, iframe.contentDocument);

    // Segunda passada: o `load` do iframe nao e o fim da historia. Fonte web,
    // imagem tardia e conteudo montado por JS chegam depois dele, e a medida
    // feita no `load` sai errada — o card ficaria do tamanho errado ate a
    // proxima mudanca do arquivo.
    if (screen.lateScan) clearTimeout(screen.lateScan);
    screen.lateScan = setTimeout(() => {
      collectAssets(screen, screen.assets);
      if (resizeToContent(screen)) layout();
    }, LATE_ASSET_SCAN_MS);

    if (screen.pendingScroll) {
      iframe.contentWindow?.scrollTo(0, screen.pendingScroll);
      screen.pendingScroll = 0;
    }

    if (resizeToContent(screen)) layout();
  });

  screens.set(file, screen);
  canvas.append(card);
  return screen;
}

/**
 * Tira a tela do board. Quem chama roda `renderSidebar()` e `layout()` depois.
 * @param {string} file
 */
export function removeCard(file) {
  const screen = screens.get(file);
  if (!screen) return;

  if (ui.interactiveFile === file) ui.interactiveFile = null;
  if (ui.openSizeMenuFile === file) ui.openSizeMenuFile = null;
  ui.lastChangedFiles = ui.lastChangedFiles.filter((marked) => marked !== file);
  if (screen.lateScan) clearTimeout(screen.lateScan);
  screen.card.remove();
  screen.item.remove();
  screens.delete(file);
}

/**
 * Recarrega so este iframe — nunca a pagina. E o que preserva o estado do
 * board: zoom, pan e o scroll das outras telas continuam intactos.
 *
 * O scroll interno e guardado e restaurado no `load` seguinte; sem isso, uma
 * edicao no rodape de uma pagina longa jogaria a tela de volta para o topo a
 * cada salvamento.
 *
 * @param {string} file
 */
export function reloadCard(file) {
  const screen = screens.get(file);
  if (!screen) return;

  try {
    screen.pendingScroll = screen.iframe.contentWindow?.scrollY ?? 0;
  } catch {
    screen.pendingScroll = 0;
  }

  screen.iframe.src = previewUrl(file);
  screen.reloadsSinceSettle += 1;

  screen.item.classList.remove('is-updated');
  // Reinicia a animacao: sem o reflow o navegador ignora a reaplicacao da classe.
  void screen.item.offsetWidth;
  screen.item.classList.add('is-updated');
}

/**
 * A pasta parou de se mexer: hora de conferir o resultado final.
 *
 * Duas coisas, e nesta ordem de custo. Toda tela e **remedida**, porque o card
 * pode ter sido dimensionado no `load`, antes de a fonte ou a imagem chegarem.
 * Tela que recarregou mais de uma vez desde o ultimo silencio **recarrega de
 * novo**: mais de um evento para o mesmo arquivo e o sintoma de escrita em
 * pedacos, e o que o board mostra pode ser um estado intermediario.
 *
 * Uma edicao atomica cai no caso barato — uma recarga so, sem segunda piscada.
 */
export function settle() {
  let moved = false;

  for (const screen of screens.values()) {
    const partial = screen.reloadsSinceSettle > 1;
    screen.reloadsSinceSettle = 0;

    if (partial) {
      reloadCard(screen.file);
      screen.reloadsSinceSettle = 0; // a recarga acima nao conta para o proximo silencio
    } else if (resizeToContent(screen)) {
      moved = true;
    }
  }

  if (moved) layout();
}

/**
 * Marca com contorno verde as telas atingidas pelo ultimo evento do servidor, e
 * so elas — a marca anterior sai.
 *
 * Serve para o usuario saber onde o agente mexeu por ultimo. Enquanto o agente
 * ainda esta escrevendo, o card pode aparecer pela metade; o contorno diz que
 * aquele card e o que acabou de mudar, e nao que ele ja esta pronto.
 *
 * @param {string[]} files telas atingidas; as que nao estao montadas sao ignoradas
 */
export function markLastChanged(files) {
  for (const file of ui.lastChangedFiles) {
    screens.get(file)?.card.classList.remove('is-updated');
  }

  ui.lastChangedFiles = files.filter((file) => screens.has(file));

  for (const file of ui.lastChangedFiles) {
    screens.get(file)?.card.classList.add('is-updated');
  }
}

/**
 * Larga o tamanho manual e mede o conteudo de novo.
 *
 * A altura volta ao padrao antes da medida pelo mesmo motivo que a largura
 * volta a `CARD_WIDTH` dentro de `resizeToContent`: o `scrollHeight` de uma
 * pagina curta e a altura do proprio frame, entao medir sem zerar apenas
 * confirmaria o tamanho que o usuario tinha escolhido.
 *
 * @param {Screen} screen
 */
function measureAgain(screen) {
  screen.sized = false;
  screen.frameHeight = DEFAULT_FRAME_HEIGHT;
  screen.frame.style.height = `${DEFAULT_FRAME_HEIGHT}px`;
  resizeToContent(screen);
}

/**
 * Devolve a tela ao tamanho do proprio conteudo, desfazendo o
 * redimensionamento manual. E a saida do menu de tamanho para quem se
 * arrependeu do arrasto ou do preset.
 * @param {string} file
 */
export function autoSizeCard(file) {
  const screen = screens.get(file);
  if (!screen) return;

  measureAgain(screen);
  layout();
  // A tela continua fixa, so nao tem mais tamanho proprio: regravar tira o
  // `width`/`height` do registro salvo.
  persistPositions();
}

/**
 * Devolve *todas* as telas ao tamanho do conteudo. Chamado junto com o
 * "Reorganizar": ele apaga a organizacao inteira do usuario, e tamanho manual
 * faz parte dela.
 *
 * Nao roda `layout()` nem grava nada — quem chama ja faz as duas coisas em
 * seguida, e um layout a mais aqui so andaria os cards duas vezes.
 */
export function resetSizes() {
  for (const screen of screens.values()) measureAgain(screen);
}

/**
 * Poe *todas* as telas no mesmo tamanho, e guarda a escolha para as que ainda
 * vao entrar (veja `ui.globalSize` e `createCard`). E o gesto do menu da
 * toolbar; o menu de cada card continua valendo por cima depois.
 *
 * Passar `null` e o "Automatico": devolve todas ao tamanho do proprio conteudo
 * e larga a escolha global, entao tela nova volta a ser medida pelo conteudo.
 *
 * O laco chama `resizeScreen` — e nao `applyPresetSize` — de proposito: este ja
 * embute o fechamento do gesto, e o board inteiro seria reorganizado e regravado
 * uma vez por tela. Aqui o `layout()` e o `persistPositions()` ficam por fora,
 * uma vez so no fim.
 *
 * A dança com `pinned` no meio resolve um aperto entre duas coisas que o gesto
 * precisa entregar. Tela fixa nao escorre, entao deixar todas fixas durante o
 * layout poria as que cresceram em cima das vizinhas; mas `persistPositions` so
 * grava tela fixa, entao deixar todas soltas faria a recarga devolver o tamanho
 * do conteudo. Dai a ordem abaixo, e dai `autoPinned`: sem separar quem o
 * usuario fixou de quem o gesto anterior fixou, o segundo gesto encontraria tudo
 * fixo e o layout nao teria o que acomodar.
 *
 * @param {{ label: string, width: number, height: number } | null} preset
 */
export function applyGlobalSize(preset) {
  ui.globalSize = preset;

  // Quem esta onde esta por vontade do usuario. Lido antes de qualquer coisa: o
  // laco abaixo passa por `resizeScreen`, que limpa `autoPinned`.
  const userPlaced = new Set(
    [...screens.values()].filter((screen) => screen.pinned && !screen.autoPinned)
      .map((screen) => screen.file),
  );

  // O que o gesto anterior fixou volta a escorrer, para o layout poder acomodar.
  for (const screen of screens.values()) {
    if (!userPlaced.has(screen.file)) screen.pinned = false;
  }

  if (preset) {
    for (const screen of screens.values()) {
      resizeScreen(screen.file, preset.width, preset.height);
      screen.pinned = userPlaced.has(screen.file);
    }
  } else {
    // No "Automatico" nao ha tamanho a preservar — a tela volta a ser medida
    // pelo conteudo na recarga de qualquer jeito — entao fixar tudo no fim so
    // congelaria o board sem ganho nenhum.
    resetSizes();
  }

  layout();

  if (preset) {
    // Sobrou o que o layout nao move: duas telas do usuario que cresceram uma
    // dentro da outra. Depois do layout de proposito — separar antes seria
    // contra posicoes que ainda iam mudar.
    separateCollisions();
    for (const screen of screens.values()) {
      screen.pinned = true;
      screen.autoPinned = !userPlaced.has(screen.file);
    }
  }

  persistPositions();
}

/**
 * Abre o menu de tamanho de uma tela, ou fecha o que ja estava aberto nela.
 * Um menu por vez, pelo mesmo motivo da tela interativa.
 * @param {string} file
 */
export function toggleSizeMenu(file) {
  const next = ui.openSizeMenuFile === file ? null : file;
  closeSizeMenu();
  if (!next) return;

  ui.openSizeMenuFile = next;
  const screen = screens.get(next);
  screen?.card.classList.add('has-open-menu');
  screen?.card.querySelector('.card-resize-btn')?.setAttribute('aria-expanded', 'true');
}

/** Fecha o menu de tamanho aberto, se houver algum. */
export function closeSizeMenu() {
  if (!ui.openSizeMenuFile) return;

  const screen = screens.get(ui.openSizeMenuFile);
  screen?.card.classList.remove('has-open-menu');
  screen?.card.querySelector('.card-resize-btn')?.setAttribute('aria-expanded', 'false');
  ui.openSizeMenuFile = null;
}

/**
 * Libera uma tela para receber cliques (preencher formulario, navegar). Uma por
 * vez: passar `null` devolve o controle ao board.
 * @param {string | null} file
 */
export function setInteractive(file) {
  if (ui.interactiveFile === file) return;

  if (ui.interactiveFile) screens.get(ui.interactiveFile)?.card.classList.remove('is-interactive');
  ui.interactiveFile = file;

  if (file) {
    screens.get(file)?.card.classList.add('is-interactive');
    setCurrent(file);
  }
}
