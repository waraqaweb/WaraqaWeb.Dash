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
        className="w-full max-w-xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-amber-50 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <Trophy className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold">Tic Tac Toe</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">Use numbers to guide the move if one student cannot control the screen.</p>
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

        <div className="grid gap-4 p-4 md:grid-cols-[1fr_240px]">
          <div className="grid grid-cols-3 gap-2 rounded-[24px] bg-slate-50 p-3 shadow-inner">
            {board.map((cell, index) => {
              const isWinningCell = winner && WIN_LINES.some((line) => line.includes(index) && board[line[0]] === winner);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setCell(index)}
                  className={`group flex aspect-square items-center justify-center rounded-2xl border text-2xl font-semibold transition ${
                    isWinningCell
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-900 hover:border-emerald-300 hover:bg-emerald-50'
                  }`}
                >
                  {cell ? (
                    <span className="text-4xl leading-none">{cell}</span>
                  ) : (
                    <span className="text-sm font-semibold tracking-[0.2em] text-slate-400 transition group-hover:text-emerald-700">{index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{statusText}</div>
            </div>

            <div className="grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Player one label
                <input
                  type="text"
                  value={playerOne}
                  onChange={(event) => setPlayerOne(event.target.value.slice(0, 2))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  placeholder="X"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Player two label
                <input
                  type="text"
                  value={playerTwo}
                  onChange={(event) => setPlayerTwo(event.target.value.slice(0, 2))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  placeholder="O"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Player one</div>
                <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                  <Circle className="h-4 w-4 text-emerald-600" /> {playerOne || 'X'}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Player two</div>
                <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                  <X className="h-4 w-4 text-rose-600" /> {playerTwo || 'O'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={resetGame}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            >
              <RotateCcw className="h-4 w-4" /> Repeat game
            </button>

            <p className="text-xs leading-relaxed text-slate-500">
              The board stays simple and readable on screen share. Use the numbered empty boxes to call out moves.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TicTacToeModal;
