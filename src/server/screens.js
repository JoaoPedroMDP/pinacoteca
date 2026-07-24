// Descoberta das telas: varre a pasta em busca de arquivos .html.

import fs from 'node:fs/promises';
import path from 'node:path';

// Pastas que nunca contem prototipos escritos a mao.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

export function isIgnoredDir(name) {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

export function isHtmlFile(name) {
  return /\.html?$/i.test(name);
}

/**
 * Lista os HTMLs da pasta recursivamente.
 * Devolve caminhos relativos a `rootDir`, sempre com barra normal.
 */
export async function listScreens(rootDir) {
  const found = [];

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
