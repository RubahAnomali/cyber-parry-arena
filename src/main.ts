import { Game } from './Game';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #game canvas');

const game = new Game(canvas);
game.start();

// Keep hot-reload clean: tear down listeners and the RAF loop before the module is replaced.
if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());

// Handy for poking at the sim from the devtools console.
(window as unknown as { game: Game }).game = game;
