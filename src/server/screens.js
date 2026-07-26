// @ts-check
// Descoberta das telas e a politica de "o que faz parte de um prototipo".
//
// A mesma politica decide duas coisas: o que a varredura ignora e o que a rota
// `/preview/` recusa servir. Por isso ambas moram aqui — se divergirem, a
// ferramenta lista um arquivo que depois se recusa a mostrar.

import fs from 'node:fs/promises';
import path from 'node:path';

// Pastas que nunca contem prototipos escritos a mao.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

/**
 * Pasta que a varredura pula e a rota `/preview/` recusa.
 * Oculta (comeca com ponto) ou pasta de build conhecida.
 *
 * @param {string} name nome de um segmento de caminho, nao o caminho inteiro
 * @returns {boolean}
 */
export function isIgnoredDir(name) {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

/**
 * @param {string} name nome do arquivo, nao o caminho inteiro
 * @returns {boolean}
 */
export function isHtmlFile(name) {
  return /\.html?$/i.test(name);
}

/**
 * Recusa o que nao faz parte de um prototipo: a propria raiz, arquivos e pastas
 * ocultos (`.env`, `.git/config`, `.ssh`) e pastas de build.
 *
 * A ferramenta e apontada para pastas arbitrarias, entao servir tudo que esta
 * abaixo da raiz nao basta ser "so localhost": qualquer pagina aberta no mesmo
 * navegador consegue disparar requisicoes para ca.
 *
 * Assume que `absolutePath` ja passou por `resolveInside` — aqui so se decide
 * politica de conteudo, nao path traversal.
 *
 * @param {string} rootDir raiz observada (caminho absoluto)
 * @param {string} absolutePath caminho absoluto a checar
 * @returns {boolean} true quando o caminho nao pode ser servido
 */
export function isForbiddenPreviewPath(rootDir, absolutePath) {
  const relative = path.relative(rootDir, absolutePath);
  if (relative === '') return true;

  return relative.split(path.sep).some((segment) => segment.startsWith('.') || isIgnoredDir(segment));
}

/**
 * Lista os HTMLs da pasta recursivamente.
 *
 * @param {string} rootDir raiz observada (caminho absoluto)
 * @returns {Promise<string[]>} caminhos relativos a `rootDir`, sempre com barra
 *   normal e em ordem alfabetica
 */
export async function listScreens(rootDir) {
  /** @type {string[]} */
  const found = [];

  /** @param {string} dir */
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Pasta sumiu ou sem permissao de leitura: ignora e segue.
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) await walk(absolute);
      } else if (entry.isFile() && isHtmlFile(entry.name)) {
        found.push(path.relative(rootDir, absolute).split(path.sep).join('/'));
      }
    }
  }

  await walk(rootDir);
  found.sort((a, b) => a.localeCompare(b));
  return found;
}
