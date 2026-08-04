/**
 * main.ts — boot.
 *
 * Constructs the engine, hands it to the Game, and gets out of the way.
 * Everything interesting lives in src/game/Game.ts.
 */

import { Engine } from './core/Engine';
import { Game } from './game/Game';

const bootEl = document.getElementById('boot');
const bootBar = document.getElementById('boot-bar') as HTMLElement | null;
const bootLabel = document.getElementById('boot-label') as HTMLElement | null;

function progress(p: number, label?: string): void {
  if (bootBar) bootBar.style.width = `${Math.round(p * 100)}%`;
  if (label && bootLabel) bootLabel.textContent = label;
}

async function boot(): Promise<void> {
  const container = document.getElementById('app')!;

  // The capture harness pins resolution and drives the clock manually.
  const params = new URLSearchParams(location.search);
  const fixedPr = params.has('pr') ? Number(params.get('pr')) : null;

  const engine = new Engine({
    container,
    maxPixelRatio: 2,
    fixedPixelRatio: fixedPr,
  });

  const game = new Game(engine, { params });
  await game.load(progress);

  progress(1, 'Ready');
  bootEl?.classList.add('done');
  setTimeout(() => bootEl?.remove(), 500);

  engine.start();

  // Exposed for the Playwright capture harness — see tools/capture/.
  (window as unknown as Record<string, unknown>).__DESCENT__ = { engine, game };
}

boot().catch((err) => {
  console.error(err);
  if (bootLabel) bootLabel.textContent = 'Failed to start — see console';
  if (bootBar) bootBar.style.background = '#e0574c';
});
