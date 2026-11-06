'use client';

import { useEffect, useRef, useState } from 'react';

const RELAY = 'wss://pickle-hand-relay.pickle-delhi.workers.dev/claims';

const PANELS = [
  {
    num: '01',
    name: 'PHYSICAL',
    buys: 'buying hands',
    accent: 'var(--red)',
    def: 'Some failures cannot be solved remotely, by definition: the robot is powerless, immobilized, or the fix lies outside its own actuation. A human must be present.',
    demo: 'DEMO · a dying Watcher posts its own rescue — scan the QR on its face, plug it in. Power returning is the proof. Claim → verified in 5 seconds, on real hardware.',
    economy: 'Creates a micro-labor economy: people monetize proximity and hands; robots buy uptime.',
  },
  {
    num: '02',
    name: 'REMOTE',
    buys: 'buying skill',
    accent: 'var(--cyan)',
    def: 'The body is capable but the skill or judgment isn’t. Nobody needs to be on-site — a verified human pilots the robot through the gap. Every session doubles as training data.',
    demo: 'DEMO · a Unitree G1 blocked by a fallen rail. A human claims the bounty and clears it through Snap Spectacles hand-tracking — their hands become its arms, pinch to grip.',
    economy: 'Creates a skill-and-data economy: dexterity sold by the minute, demonstrations that compound into autonomy.',
  },
  {
    num: '03',
    name: 'MACHINE',
    buys: 'buying services',
    accent: 'var(--yellow)',
    def: 'When the help a robot needs is something another machine already has — a charging slot, a tool, queue priority — no human belongs in the loop. The robots transact directly.',
    demo: 'DEMO · charging-slot negotiation, agent to agent: one use case of a general machine-to-machine service market.',
    economy: 'Creates a machine-to-machine economy: the market clears even when no human is around.',
  },
];

const PIPELINE = [
  { chip: '*-*', accent: 'var(--red)', text: 'The robot detects its own failure. Its agent decides what help to buy — every decision runs on 0G Compute and lands on 0G Storage with a request id. If 0G is unreachable, the robot safe-stops; it never fakes a decision.' },
  { chip: 'JOB OPEN', accent: 'var(--orange)', text: 'The robot is the job board: the bounty renders where the failure is — a QR on the Watcher’s screen, an overlay above the G1, AR through Spectacles.' },
  { chip: 'CLAIMED', accent: 'var(--cyan)', text: 'Identity gates the market. One human, one claim — World ID proof-of-human, with a human-approval checkpoint on protected agent actions.' },
  { chip: 'VERIFIED', accent: 'var(--green)', text: 'Proof is physical: VBUS edges, joint telemetry, resume checks. Verification comes from the robot’s own sensors, not from trust.' },
];

function useLiveStats() {
  const [connected, setConnected] = useState(false);
  const [verified, setVerified] = useState(7); // interventions verified during build & live tests
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let alive = true;
    const connect = () => {
      try {
        ws = new WebSocket(RELAY);
        ws.onopen = () => alive && setConnected(true);
        ws.onclose = () => {
          if (!alive) return;
          setConnected(false);
          setTimeout(connect, 4000);
        };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m.type === 'claim_ack' && m.status === 'verified' && !seen.current.has(m.claimId)) {
              seen.current.add(m.claimId);
              setVerified((v) => v + 1);
            }
          } catch {}
        };
      } catch {}
    };
    connect();
    return () => {
      alive = false;
      ws?.close();
    };
  }, []);

  return { connected, verified };
}

export default function Home() {
  const { connected, verified } = useLiveStats();
  const [open, setOpen] = useState(0);

  return (
    <main className="grid-bg">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="snap-section items-center text-center">
        <p className="font-mono text-xs tracking-[0.35em] text-[var(--fg-dim)]">
          A LABOR MARKET FOR ROBOTS
        </p>
        <h1 className="font-display mt-5 text-7xl font-bold tracking-tight text-[var(--green)] sm:text-8xl md:text-9xl">
          PICKLE
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-[var(--fg)] sm:text-xl">
          When a robot hits its limits, it needs someone’s{' '}
          <span className="text-[var(--red)]">hands</span>, someone’s{' '}
          <span className="text-[var(--cyan)]">skill</span>, or another machine’s{' '}
          <span className="text-[var(--yellow)]">services</span>.
          <br className="hidden sm:block" /> Pickle is the market where it buys all three.
        </p>

        <div className="mt-12 grid w-full max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['ROBOTS IN FLEET', '2'],
            ['CLAIM → VERIFIED', '5s'],
            ['INTERVENTIONS VERIFIED', String(verified)],
            ['INTERVENTION CLASSES', '3'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--bg-raise)] px-4 py-5">
              <div className="font-display text-4xl text-[var(--green)] tabular-nums">{value}</div>
              <div className="font-mono mt-2 text-[10px] tracking-[0.18em] text-[var(--fg-dim)]">{label}</div>
            </div>
          ))}
        </div>

        <div className="font-mono mt-8 flex items-center gap-2 text-xs text-[var(--fg-dim)]">
          {connected ? (
            <>
              <span className="live-dot" /> LIVE — listening to the bounty relay
            </>
          ) : (
            <>figures from live hardware runs · relay offline</>
          )}
        </div>

        <div className="font-mono mt-14 animate-bounce text-sm text-[var(--fg-dim)]">▼ scroll</div>
      </section>

      {/* ── THE THREE INTERVENTIONS ──────────────────────────────────── */}
      <section className="snap-section">
        <div className="mx-auto w-full max-w-6xl">
          <p className="font-mono text-xs tracking-[0.35em] text-[var(--fg-dim)]">THE THREE INTERVENTIONS</p>
          <h2 className="font-display mt-3 text-3xl font-bold sm:text-4xl">
            Every robot failure is one of three markets.
          </h2>
          <div className="panels mt-8">
            {PANELS.map((p, i) => (
              <div
                key={p.num}
                className={`panel ${open === i ? 'open' : ''}`}
                style={{ ['--pa' as string]: p.accent }}
                onMouseEnter={() => setOpen(i)}
                onClick={() => setOpen(i)}
                onFocus={() => setOpen(i)}
                tabIndex={0}
                role="button"
                aria-expanded={open === i}
              >
                <div className="bar" />
                <div className="num font-display absolute left-5 top-5 text-xl font-bold">{p.num}</div>
                <div className="closed-label font-display text-lg font-medium text-[var(--fg-dim)]">{p.name}</div>
                <div className="body justify-center">
                  <div>
                    <span className="font-display text-3xl font-bold" style={{ color: p.accent }}>
                      {p.name}
                    </span>
                    <span className="font-mono ml-3 text-sm text-[var(--fg-dim)]">intervention · {p.buys}</span>
                  </div>
                  <p className="max-w-xl text-[15px] leading-relaxed text-[var(--fg)]">{p.def}</p>
                  <p className="font-mono max-w-xl rounded-md border border-[var(--line)] bg-[var(--bg)] p-4 text-[13px] leading-relaxed text-[var(--fg-dim)]">
                    {p.demo}
                  </p>
                  <p className="max-w-xl text-[14px] text-[var(--fg-dim)]">{p.economy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW A BOUNTY CLEARS ──────────────────────────────────────── */}
      <section className="snap-section">
        <div className="mx-auto w-full max-w-4xl">
          <p className="font-mono text-xs tracking-[0.35em] text-[var(--fg-dim)]">HOW A BOUNTY CLEARS</p>
          <h2 className="font-display mt-3 text-3xl font-bold sm:text-4xl">
            The robot’s screen is the state machine.
          </h2>
          <div className="mt-10 flex flex-col gap-6">
            {PIPELINE.map((s) => (
              <div key={s.chip} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-8">
                <div className="sm:w-40 sm:shrink-0 sm:text-right">
                  <span className="chip" style={{ ['--ca' as string]: s.accent }}>
                    {s.chip}
                  </span>
                </div>
                <p className="min-w-0 text-[15px] leading-relaxed text-[var(--fg-dim)]">{s.text}</p>
              </div>
            ))}
          </div>
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
