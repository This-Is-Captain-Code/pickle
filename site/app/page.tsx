'use client';

import { useState } from 'react';

const PANELS = [
  {
    num: '01',
    name: 'PHYSICAL',
    dir: 'HUMAN → ROBOT',
    accent: 'var(--red)',
    img: '/panels/physical.jpg',
    line: 'A human must be present. The robot buys hands.',
    demo: { label: 'DEMO →', href: '/portal' },
  },
  {
    num: '02',
    name: 'REMOTE',
    dir: 'HUMAN → ROBOT',
    accent: 'var(--cyan)',
    img: '/panels/remote.jpg',
    line: 'A human pilots it through the gap. The robot buys skill.',
    demo: { label: 'DEMO →', href: '/portal' },
  },
  {
    num: '03',
    name: 'MACHINE',
    dir: 'ROBOT → ROBOT',
    accent: 'var(--yellow)',
    img: '/panels/machine.jpg',
    line: 'Robots transact directly, peer to peer. No human in the loop.',
    demo: { label: 'DEMO →', href: '/portal' },
  },
];

export default function Home() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <main className="grid-bg">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="snap-section relative items-center text-center">
        <h1 className="font-display text-7xl font-bold tracking-tight text-[var(--green)] sm:text-8xl md:text-9xl">
          PICKLE
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-[var(--fg)] sm:text-xl">
          A labor market where robots hire humans — and each other.
        </p>
        <p className="font-mono mt-10 text-xs tracking-[0.3em] text-[var(--fg-dim)]">
          POWERED BY WORLD × 0G
        </p>
        <div className="font-mono absolute bottom-8 animate-bounce text-sm text-[var(--fg-dim)]">▼</div>
      </section>

      {/* ── THE THREE INTERVENTIONS: full-screen triptych ────────────── */}
      <section className="trip-section">
        <p className="font-mono pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-xs tracking-[0.35em] text-[var(--fg)] [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
          THE THREE INTERVENTIONS
        </p>
        <div className="trip" onMouseLeave={() => setOpen(null)}>
          {PANELS.map((p, i) => (
            <div
              key={p.num}
              className={`tpanel ${open === i ? 'open' : ''}`}
              style={{ ['--pa' as string]: p.accent }}
              onMouseEnter={() => setOpen(i)}
              onClick={() => setOpen(i)}
              onFocus={() => setOpen(i)}
              tabIndex={0}
              role="button"
              aria-expanded={open === i}
            >
              <img src={p.img} alt={`${p.name} intervention`} />
              <div className="label">
                <span className="chip self-start" style={{ ['--ca' as string]: p.accent }}>
                  {p.dir}
                </span>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-lg font-bold" style={{ color: p.accent }}>
                    {p.num}
                  </span>
                  <span className="font-display text-3xl font-bold tracking-wide text-[var(--fg)] sm:text-4xl">
                    {p.name}
                  </span>
                  <span className="font-display text-xl font-medium tracking-wide text-[var(--fg-dim)] sm:text-2xl">
                    INTERVENTION
                  </span>
                </div>
                <div className="reveal">
                  <p className="text-[15px] leading-relaxed text-[var(--fg)] sm:text-lg">{p.line}</p>
                  {p.demo.href ? (
                    <a className="demo-btn" href={p.demo.href} onClick={(e) => e.stopPropagation()}>
                      {p.demo.label}
                    </a>
                  ) : (
                    <span className="demo-btn opacity-60">{p.demo.label}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── KICKER ───────────────────────────────────────────────────── */}
      <section className="snap-section items-center text-center">
        <p className="font-display max-w-3xl text-balance text-3xl font-bold leading-snug sm:text-5xl">
          Machines have been hired by humans for a century.
          <br />
          <span className="text-[var(--green)]">Pickle is the first market that runs the other way.</span>
        </p>
        <div className="font-mono mt-12 flex flex-wrap items-center justify-center gap-4 text-sm">
          <a
            className="rounded-md border border-[var(--green)] px-5 py-2.5 text-[var(--green)] transition-colors hover:bg-[var(--green)] hover:text-[var(--bg)]"
            href="https://pickle-hand-relay.pickle-delhi.workers.dev/go"
          >
            claim a live bounty →
          </a>
          <a
            className="rounded-md border border-[var(--line)] px-5 py-2.5 text-[var(--fg-dim)] transition-colors hover:border-[var(--fg-dim)] hover:text-[var(--fg)]"
            href="https://pickle-hand-relay.pickle-delhi.workers.dev/"
          >
            spectacles teleop sender
          </a>
        </div>
        <footer className="font-mono mt-20 text-[11px] tracking-[0.2em] text-[var(--fg-dim)]">
          PICKLE · MONAD BLITZ DELHI 2026 · WORLD ID × 0G × SNAP SPECTACLES
        </footer>
      </section>
    </main>
  );
}
