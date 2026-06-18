import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { RotateCcw, Trophy, X, Circle } from 'lucide-react';

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const emptyBoard = () => Array(9).fill('');

const TicTacToeModal = ({ open, onClose }) => {
  const [board, setBoard] = useState(emptyBoard());
  const [activePlayer, setActivePlayer] = useState('x');
  const [playerOne, setPlayerOne] = useState('X');
  const [playerTwo, setPlayerTwo] = useState('O');

  const winner = useMemo(() => {
    for (const [a, b, c] of WIN_LINES) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return '';
  }, [board]);

  const isTie = useMemo(() => !winner && board.every(Boolean), [board, winner]);
  const currentSymbol = activePlayer === 'x' ? (playerOne || 'X').slice(0, 2) : (playerTwo || 'O').slice(0, 2);
  const statusText = winner
    ? `${winner === (playerOne || 'X').slice(0, 2) ? (playerOne || 'X').slice(0, 2) : (playerTwo || 'O').slice(0, 2)} wins the round!`
    : isTie
      ? 'It is a tie. Start the next round.'
      : `${currentSymbol}'s turn`;
  const gameOver = Boolean(winner || isTie);
  const overlayText = winner
    ? `${winner} wins!`
    : 'Tie game';

  useEffect(() => {
    if (!open) return;
    setBoard(emptyBoard());
    setActivePlayer('x');
    setPlayerOne((prev) => (prev || 'X').slice(0, 2));
    setPlayerTwo((prev) => (prev || 'O').slice(0, 2));
  }, [open]);

  if (!open) return null;

  const setCell = (index) => {
    if (board[index] || winner || isTie) return;
    const next = [...board];
    next[index] = activePlayer === 'x' ? (playerOne || 'X').slice(0, 2) : (playerTwo || 'O').slice(0, 2);
    setBoard(next);
    setActivePlayer((prev) => (prev === 'x' ? 'o' : 'x'));
  };

  const resetGame = () => {
    setBoard(emptyBoard());
    setActivePlayer('x');
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex h-[92vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-amber-50 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <Trophy className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold">Tic Tac Toe</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">Board-first mode for screen sharing.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-slate-900"
            aria-label="Close game"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative flex flex-1 flex-col items-center justify-between gap-3 p-3 sm:p-4">
          <div className="flex w-full flex-1 items-center justify-center">
            <div
              className="grid grid-cols-3 gap-1 rounded-[24px] bg-slate-100 p-2 shadow-inner"
              style={{ width: 'min(82vmin, 92vw)', height: 'min(82vmin, 92vw)' }}
            >
              {board.map((cell, index) => {
                const isWinningCell = winner && WIN_LINES.some((line) => line.includes(index) && board[line[0]] === winner);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setCell(index)}
                    className={`group flex items-center justify-center rounded-xl border text-3xl font-semibold transition sm:text-5xl ${
                      isWinningCell
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-900 hover:border-emerald-300 hover:bg-emerald-50'
                    }`}
                  >
                    {cell ? (
                      <span className="leading-none">{cell}</span>
                    ) : (
                      <span className="text-base font-semibold tracking-[0.16em] text-slate-400 transition group-hover:text-emerald-700 sm:text-xl">{index + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="w-full rounded-2xl border border-slate-200 bg-white px-2.5 py-2.5 shadow-sm">
            <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[170px_170px_1fr_auto]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">
                P1
                <input
                  type="text"
                  value={playerOne}
                  onChange={(event) => setPlayerOne(event.target.value.slice(0, 2))}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  placeholder="X"
                />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">
                P2
                <input
                  type="text"
                  value={playerTwo}
                  onChange={(event) => setPlayerTwo(event.target.value.slice(0, 2))}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  placeholder="O"
                />
              </label>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <span className="inline-flex items-center gap-1">
                  <Circle className="h-4 w-4 text-emerald-600" />
                  {statusText}
                </span>
              </div>
              <button
                type="button"
                onClick={resetGame}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
              >
                <RotateCcw className="h-4 w-4" /> Repeat
              </button>
            </div>
          </div>

          {gameOver && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/45">
              <div className="pointer-events-auto mx-4 w-full max-w-lg rounded-3xl border border-white/70 bg-white/95 px-6 py-8 text-center shadow-2xl">
                <div className="text-5xl font-black tracking-tight text-emerald-800 sm:text-7xl">{overlayText}</div>
                <button
                  type="button"
                  onClick={resetGame}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
                >
                  <RotateCcw className="h-4 w-4" /> Play again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TicTacToeModal;
