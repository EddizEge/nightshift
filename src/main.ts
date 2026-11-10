import { NightshiftGame } from './core/NightshiftGame';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Fatal: #game-canvas not found in DOM.');
}

const game = new NightshiftGame(canvas);
game.boot().catch((err) => {
  console.error('NIGHTSHIFT boot error:', err);
  const statusEl = document.getElementById('loading-status');
  if (statusEl) {
    statusEl.textContent = `Initialization error: ${err instanceof Error ? err.message : String(err)}`;
  }
});
