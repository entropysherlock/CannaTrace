"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Maximize2,
  Minimize2,
  MousePointerClick,
  X,
} from "lucide-react";
import {
  FIND_NOUNS,
  stepAfterArriving,
  walkthroughById,
  WALKTHROUGHS,
  type Step,
  type Target,
  type Walkthrough,
} from "@/lib/walkthroughs";

/**
 * SmartWorkflows "Show me how": a spotlight on the next thing to do, with a short instruction beside it,
 * that follows the employee from page to page through a whole job. It never blocks the page: everything
 * outside the spotlight is dimmed but still clickable.
 */

/** Where the employee is: the walkthrough, the step, and the page each step was last seen on (for Back). */
type State = { id: string; i: number; urls?: Record<number, string> } | null;
const KEY = "ct-walkthrough";
const DONE_KEY = "ct-walkthroughs-done";

function load<T>(storage: "session" | "local", key: string, fallback: T): T {
  try {
    const raw = (storage === "session" ? sessionStorage : localStorage).getItem(
      key,
    );
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(storage: "session" | "local", key: string, value: unknown) {
  try {
    const s = storage === "session" ? sessionStorage : localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be off; the walkthrough still works until a full reload */
  }
}

/** Where the employee is in a walkthrough, kept in sessionStorage so it survives page loads, shared through a tiny store. */
const listeners = new Set<() => void>();
let memory: string | null = null;
let cached: { raw: string | null; value: State } = { raw: null, value: null };
function readState(): State {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    raw = memory;
  }
  if (raw !== cached.raw)
    cached = { raw, value: raw ? (JSON.parse(raw) as State) : null };
  return cached.value;
}
function writeState(next: State) {
  memory = next ? JSON.stringify(next) : null;
  save("session", KEY, next);
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const visible = (el: Element) =>
  (el as HTMLElement).offsetParent !== null ||
  (el as HTMLElement).getClientRects().length > 0;
const words = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function cardNamed(main: Element, title: string): HTMLElement | null {
  return (
    ([...main.querySelectorAll("section")].find(
      (s) => words(s.querySelector("h2")) === title,
    ) as HTMLElement | undefined) ?? null
  );
}

/** Fold-outs a step has already opened, so closing one by hand keeps it closed. */
const opened = new Set<string>();

/** What to draw the spotlight around: a link's whole row, so the box isn't just the link text. */
const highlightOf = (el: HTMLElement) =>
  el.tagName === "A"
    ? ((el.closest("li, tr") as HTMLElement | null) ?? el)
    : el;

/** Find what a step points at, on the page as it is now. */
export function findTarget(
  targets: Target[] | undefined,
  key = "",
): HTMLElement | null {
  const main = document.querySelector("main");
  if (!main || !targets) return null;
  for (const t of targets) {
    let el: HTMLElement | null = null;
    if ("card" in t) el = cardNamed(main, t.card);
    else if ("fold" in t) {
      const d = [...main.querySelectorAll("details")].find((x) =>
        words(x.querySelector("summary")).startsWith(t.fold),
      ) as HTMLDetailsElement | undefined;
      if (d) {
        if (!opened.has(key)) {
          opened.add(key);
          d.open = true;
        }
        el = d;
      }
    } else if ("text" in t) {
      // Buttons first, so "Receive" finds the submit button before a tab named Receive.
      const pool = [
        ...main.querySelectorAll("button"),
        ...main.querySelectorAll("a"),
      ];
      el =
        (pool.find((x) => visible(x) && words(x).startsWith(t.text)) as
          HTMLElement | undefined) ?? null;
    } else if ("link" in t) {
      const scope = t.inCard ? cardNamed(main, t.inCard) : main;
      el =
        (scope &&
          ([...scope.querySelectorAll(`a[href^="${t.link}"]`)].find(
            (a) => visible(a) && !t.except?.some((x) => (a.getAttribute("href") ?? "").startsWith(x)),
          ) as
            HTMLElement | undefined)) ??
        null;
    } else if ("field" in t) {
      const f = main.querySelector(`[name="${t.field}"]`) as HTMLElement | null;
      el = f ? ((f.closest("label") as HTMLElement | null) ?? f) : null;
    }
    if (el && visible(el)) return el;
  }
  return null;
}

/** The page for a step: where it was last seen, its fixed address, or the newest matching record here. */
async function pageFor(step: Step, seenAt?: string): Promise<string | null> {
  if (seenAt) return seenAt;
  if (step.go) return step.go;
  if (!step.find) return null;
  try {
    const q = new URLSearchParams({ kind: step.find.kind, status: (step.find.status ?? []).join(",") });
    const res = await fetch(`/api/walkthrough/find?${q}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as { url: string | null }).url : null;
  } catch {
    return null;
  }
}

type Ctx = { start: (id: string) => void; openPicker: () => void; available: boolean };
const WalkCtx = createContext<Ctx>({ start: () => {}, openPicker: () => {}, available: false });
export const useWalkthrough = () => useContext(WalkCtx);

export function WalkthroughProvider({
  allowed,
  children,
}: {
  allowed: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribe, readState, () => null);
  const [picker, setPicker] = useState(false);
  const [finished, setFinished] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  // Another window that needs the person's answer (the register's payment window, a confirm box) is open:
  // the walkthrough steps aside until it closes, so it never covers something they must press.
  const [aside, setAside] = useState(false);
  const scrolledFor = useRef<string>("");

  const walk: Walkthrough | undefined = state
    ? walkthroughById(state.id)
    : undefined;

  useEffect(() => {
    if (!state) return;
    const check = () => setAside(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]:not([data-walk-own])')));
    check();
    const t = window.setInterval(check, 250);
    return () => window.clearInterval(t);
  }, [state]);
  const step = walk?.steps[state!.i];

  const update = useCallback((next: State) => writeState(next), []);

  const start = useCallback(
    (id: string) => {
      const w = walkthroughById(id);
      if (!w) return;
      setPicker(false);
      setFinished(null);
      update({ id, i: 0 });
      if (!w.steps[0].path.test(window.location.pathname) && w.steps[0].go)
        router.push(w.steps[0].go);
    },
    [router, update],
  );

  // ?walk=<id> starts one from a link; a reload picks up where it was from sessionStorage.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("walk");
    const w =
      fromLink && allowed.includes(fromLink)
        ? walkthroughById(fromLink)
        : undefined;
    if (!w) return;
    writeState({ id: w.id, i: 0 });
    if (!w.steps[0].path.test(window.location.pathname) && w.steps[0].go)
      router.push(w.steps[0].go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arriving on a new page can complete a step (a form saved and moved on). This runs only when the
  // page changes, never when the step changes, so Back isn't undone by jumping forward again.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    const changed = lastPath.current !== pathname;
    lastPath.current = pathname;
    if (!walk || !state) return;
    const i = changed ? stepAfterArriving(walk, state.i, pathname) : state.i;
    const url = window.location.pathname + window.location.search;
    const here = walk.steps[i].path.test(pathname);
    if (i !== state.i || (here && state.urls?.[i] !== url)) update({ ...state, i, urls: here ? { ...state.urls, [i]: url } : state.urls });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, walk?.id, state?.i]);

  const onPage = Boolean(step && step.path.test(pathname));

  /*
   * A step that happens on another page opens that page by itself: its fixed address, the record it was last
   * seen on, or the newest matching one here (the newest order waiting to be picked). It waits a moment first,
   * because a click or a save may already be taking the person there. It does this once per step: someone who
   * then wanders off on purpose isn't pulled back, and gets "Take me back" instead.
   */
  // What happened to the current step's page: being opened (from the path it was opened from), nothing here to
  // show it on, or the person left it themselves.
  const [auto, setAuto] = useState<{ key: string; phase: "opened" | "nothing" | "left"; from?: string; noun?: string } | null>(null);
  const stepKey = state ? `${state.id}:${state.i}` : "";
  useEffect(() => {
    if (!state || !walk || !step) return;
    const key = `${state.id}:${state.i}`;
    if (onPage) return;
    let cancelled = false;
    // Already on its page once (it's remembered, even across a reload) and then left on purpose: offer
    // "Take me back" instead of pulling them there.
    const leftOnPurpose = Boolean(readState()?.urls?.[state.i]);
    const t = window.setTimeout(
      async () => {
        if (cancelled || step.path.test(window.location.pathname)) return;
        if (leftOnPurpose) {
          setAuto({ key, phase: "left" });
          return;
        }
        const from = window.location.pathname;
        const url = await pageFor(step, readState()?.urls?.[state.i]);
        const cur = readState();
        if (cancelled || !cur || `${cur.id}:${cur.i}` !== key) return;
        if (url) {
          setAuto({ key, phase: "opened", from });
          router.push(url);
        } else setAuto({ key, phase: "nothing", noun: step.find ? (step.find.none ?? FIND_NOUNS[step.find.kind]) : "the page for this step" });
      },
      leftOnPurpose ? 0 : 700,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.id, state?.i, onPage]);
  const mine = auto?.key === stepKey ? auto : null;
  const nothingToShow = !onPage && mine?.phase === "nothing" ? (mine.noun ?? null) : null;
  const opening = !onPage && (!mine || (mine.phase === "opened" && mine.from === pathname));

  /**
   * Go to a step, opening its page when it lives somewhere else, so Next and Back never need a second
   * click: its fixed address, or the page it was last seen on (a particular harvest or order).
   * It reads the walkthrough as it is now, not as a delayed callback saw it.
   */
  const moveTo = useCallback(
    (i: number, navigate: boolean) => {
      const cur = readState();
      const w = cur ? walkthroughById(cur.id) : undefined;
      if (!cur || !w) return;
      const to = w.steps[i];
      update({ ...cur, i });
      if (!navigate || !to || to.path.test(window.location.pathname)) return;
      const url = cur.urls?.[i] ?? to.go;
      if (url) router.push(url);
      else if (i < cur.i) router.back();
    },
    [update, router],
  );

  /** Move on from step `from`. Ignored if the walkthrough already moved (a save and a vanished card both fired). */
  const next = useCallback(
    (navigate: boolean, from: number) => {
      const cur = readState();
      const w = cur ? walkthroughById(cur.id) : undefined;
      if (!cur || !w || cur.i !== from) return;
      if (from + 1 >= w.steps.length) {
        const done = load<string[]>("local", DONE_KEY, []);
        save("local", DONE_KEY, [...new Set([...done, w.id])]);
        setFinished(w.title);
        update(null);
        return;
      }
      moveTo(from + 1, navigate);
    },
    [update, moveTo],
  );

  // Keep the spotlight on the target as the page scrolls, resizes, or re-renders.
  useLayoutEffect(() => {
    if (!step || !onPage) return;
    let tries = 0;
    let seen = false;
    let gone = 0;
    // A step whose card disappears after it was there (confirming an order removes "Confirm the order") is done.
    const finishesByVanishing = step.advance !== "click" && step.advance !== "next" && Boolean(step.target?.some((t) => "card" in t));
    const key = `${state!.id}:${state!.i}:${pathname}`;
    const tick = () => {
      const found = findTarget(step.target, key);
      const el = found ? highlightOf(found) : null;
      if (el) {
        if (scrolledFor.current !== key) {
          scrolledFor.current = key;
          // On phones the bubble docks at the bottom, so bring the target up near the top instead.
          // Tall targets (an opened form) show from their top, not their middle.
          const r = el.getBoundingClientRect();
          if (window.innerWidth < 768 || r.height > window.innerHeight - 160)
            window.scrollBy({ top: r.top - 90, behavior: "smooth" });
          else el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        setRect(el.getBoundingClientRect());
        setMissing(false);
        seen = true;
        gone = 0;
      } else {
        setRect(null);
        setMissing(Boolean(step.target) && ++tries > 4);
        // An optional step whose target never showed up is already done (the drawer is open): move on.
        if (step.optional && !seen && tries > 8) next(false, state!.i);
        if (seen && finishesByVanishing && ++gone === 4) next(true, state!.i);
      }
    };
    tick();
    const t = window.setInterval(tick, 250);
    window.addEventListener("scroll", tick, { passive: true, capture: true });
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("scroll", tick, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("resize", tick);
    };
  }, [step, onPage, pathname, state, next]);


  // "Click" steps move on when the highlighted thing is clicked.
  useEffect(() => {
    if (!step || step.advance !== "click" || !onPage) return;
    const from = state!.i;
    const onClick = (e: MouseEvent) => {
      const el = findTarget(step.target);
      // The click itself opens the next page, so don't navigate as well.
      if (el && e.target instanceof Node && el.contains(e.target))
        window.setTimeout(() => next(false, from), 0);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, onPage, next, state?.i]);

  // "Save" steps (the default) move on when a form in the highlighted area saves.
  useEffect(() => {
    if (!step || !onPage || step.advance === "click" || step.advance === "next")
      return;
    const from = state!.i;
    const onSaved = (e: Event) => {
      const form = (e as CustomEvent<HTMLFormElement | null>).detail;
      const el = findTarget(step.target);
      if (form && el && (el.contains(form) || form.contains(el)))
        window.setTimeout(() => next(true, from), 600);
    };
    window.addEventListener("ct:form-saved", onSaved);
    return () => window.removeEventListener("ct:form-saved", onSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, onPage, next, state?.i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPicker(false);
        if (state) update(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, update]);

  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(() => setFinished(null), 6000);
    return () => window.clearTimeout(t);
  }, [finished]);

  const options = WALKTHROUGHS.filter((w) => allowed.includes(w.id));
  const done =
    typeof window === "undefined" ? [] : load<string[]>("local", DONE_KEY, []);

  return (
    <WalkCtx.Provider value={{ start, openPicker: () => setPicker(true), available: options.length > 0 }}>
      {children}


      {picker ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-brand-950/50 p-3 sm:items-center print:hidden"
          onClick={() => setPicker(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-walk-own="true"
            aria-labelledby="walk-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2
                id="walk-title"
                className="flex items-center gap-2 text-lg font-extrabold text-brand-950"
              >
                <GraduationCap
                  className="h-5 w-5 text-brand-700"
                  aria-hidden="true"
                />
                Show me how
              </h2>
              <button
                type="button"
                onClick={() => setPicker(false)}
                aria-label="Close"
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              Pick a job. Leaf2Sale highlights each step, page to page, using
              your real data. Nothing is saved unless you save it.
            </p>
            <ul className="space-y-2">
              {options.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => start(w.id)}
                    data-testid={`walk-${w.id}`}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-brand-100 px-4 py-3 text-left transition hover:border-brand-500 hover:bg-brand-50"
                  >
                    <span>
                      <span className="flex items-center gap-2 font-bold text-brand-950">
                        {w.title}
                        {done.includes(w.id) ? (
                          <CheckCircle2
                            className="h-4 w-4 text-brand-600"
                            aria-label="Done before"
                          />
                        ) : null}
                      </span>
                      <span className="block text-sm text-slate-600">
                        {w.summary}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                      {w.steps.length} steps · ~{w.minutes} min
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {walk && step && !aside ? (
        <>
          {rect && onPage ? (
            <div
              aria-hidden="true"
              data-testid="walk-spotlight"
              className="pointer-events-none fixed z-[65] rounded-xl ring-4 ring-amber-300 transition-all duration-200 print:hidden"
              style={{
                top: rect.top - 8,
                left: rect.left - 8,
                width: rect.width + 16,
                height: rect.height + 16,
                boxShadow:
                  "0 0 0 9999px rgba(12, 48, 32, 0.45), 0 0 24px 6px rgba(252, 211, 77, 0.6)",
              }}
            >
              <span className="absolute inset-0 animate-pulse rounded-xl ring-4 ring-amber-200" />
            </div>
          ) : null}
          <Bubble
            walk={walk}
            i={state!.i}
            rect={onPage ? rect : null}
            onPage={onPage}
            missing={onPage && missing}
            // Read the live position, not this render's, so quick clicks never act on a stale step.
            onBack={() => {
              const cur = readState();
              if (cur) moveTo(Math.max(0, cur.i - 1), true);
            }}
            onNext={() => {
              const cur = readState();
              if (cur) next(true, cur.i);
            }}
            onExit={() => update(null)}
            onGo={async () => {
              const url = await pageFor(step, readState()?.urls?.[state!.i]);
              if (url) router.push(url);
              else setAuto({ key: stepKey, phase: "nothing", noun: step.find ? (step.find.none ?? FIND_NOUNS[step.find.kind]) : "the page for this step" });
            }}
            canGo={Boolean(state!.urls?.[state!.i] ?? step.go ?? step.find) && !nothingToShow}
            opening={opening}
            nothingToShow={nothingToShow}
          />
        </>
      ) : null}

      {finished ? (
        <div
          role="status"
          className="fixed inset-x-3 bottom-24 z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-brand-900 px-5 py-4 text-white shadow-2xl md:bottom-8 print:hidden"
        >
          <CheckCircle2
            className="h-6 w-6 shrink-0 text-amber-300"
            aria-hidden="true"
          />
          <p className="text-sm">
            <strong>Nice work.</strong> You finished “{finished}”. Find more
            under Show me how.
          </p>
        </div>
      ) : null}
    </WalkCtx.Provider>
  );
}

function Bubble({
  walk,
  i,
  rect,
  onPage,
  missing,
  onBack,
  onNext,
  onExit,
  onGo,
  canGo,
  opening,
  nothingToShow,
}: {
  walk: Walkthrough;
  i: number;
  rect: DOMRect | null;
  onPage: boolean;
  missing: boolean;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
  onGo: () => void;
  canGo: boolean;
  /** The step's page is being opened. */
  opening: boolean;
  /** There's no record here to show this step on (no harvest yet): what's missing. */
  nothingToShow: string | null;
}) {
  const step = walk.steps[i];
  const last = i === walk.steps.length - 1;
  const [wide, setWide] = useState(true);
  // Shrunk to a slim bar, for small screens where the bubble would cover what you need.
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const m = () => setWide(window.innerWidth >= 768);
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, []);

  if (small)
    return (
      <div
        role="dialog"
        aria-label={`${walk.title}, step ${i + 1} of ${walk.steps.length}`}
        data-testid="walk-bubble"
        className="fixed bottom-24 left-3 z-[66] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-amber-300 bg-white py-1.5 pl-4 pr-1.5 shadow-2xl md:bottom-6 md:left-auto md:right-24 print:hidden"
      >
        <span className="truncate text-sm font-bold text-brand-950">
          {i + 1}/{walk.steps.length} · {step.title}
        </span>
        <button
          type="button"
          onClick={() => setSmall(false)}
          aria-label="Show the instructions"
          className="rounded-full p-2 text-brand-700 hover:bg-brand-50"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-full bg-brand-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          {last ? "Finish" : "Next"}
        </button>
      </div>
    );

  // Beside the spotlight on wide screens; docked at the bottom on phones or with nothing to point at.
  let style: React.CSSProperties | undefined;
  if (wide && rect && onPage) {
    const W = 340;
    const H = 250; // about how tall the bubble is
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (t: number) => Math.min(Math.max(12, t), vh - H - 12);
    const left = Math.min(Math.max(12, rect.left), vw - W - 12);
    if (vh - rect.bottom > H + 24)
      style = { top: rect.bottom + 20, left, width: W };
    else if (rect.top > H + 24)
      style = {
        top: rect.top - 20,
        left,
        width: W,
        transform: "translateY(-100%)",
      };
    else if (vw - rect.right > W + 32)
      style = { top: clampTop(rect.top), left: rect.right + 20, width: W };
    else if (rect.left > W + 32)
      style = { top: clampTop(rect.top), left: rect.left - W - 20, width: W };
    // Otherwise it docks at the bottom of the screen.
  }

  return (
    <div
      role="dialog"
      aria-label={`${walk.title}, step ${i + 1} of ${walk.steps.length}`}
      data-testid="walk-bubble"
      style={style}
      className={`fixed z-[66] rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl print:hidden ${style ? "" : "inset-x-3 bottom-24 mx-auto max-w-md md:bottom-8"}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
          {walk.title} · step {i + 1} of {walk.steps.length}
        </p>
        <span className="flex items-center">
          <button
            type="button"
            onClick={() => setSmall(true)}
            aria-label="Shrink the instructions"
            title="Shrink"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit the walkthrough"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className="mb-3 flex gap-1" aria-hidden="true">
        {walk.steps.map((_, k) => (
          <span
            key={k}
            className={`h-1.5 flex-1 rounded-full ${k < i ? "bg-brand-600" : k === i ? "bg-amber-400" : "bg-slate-200"}`}
          />
        ))}
      </div>
      <h3 className="text-base font-extrabold text-brand-950">{step.title}</h3>
      {onPage ? (
        <>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            {step.body}
          </p>
          {missing ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              That isn&apos;t on this page right now. It may already be done, or
              need an earlier step first. Press Next to carry on.
            </p>
          ) : null}
          {step.advance === "click" && !missing ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <MousePointerClick className="h-4 w-4" aria-hidden="true" />
              Click the highlighted spot to continue.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{step.body}</p>
          {nothingToShow ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="walk-nothing">
              There isn&apos;t {nothingToShow} here yet to show this on. Do the earlier steps first, or press Next to carry on.
            </p>
          ) : opening ? (
            <p className="mt-2 text-xs font-semibold text-brand-700" data-testid="walk-opening">
              Opening the page for this step…
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-600">You&apos;ve left this step&apos;s page.</p>
          )}
        </>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={i === 0}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:invisible"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        {!onPage && canGo && !opening ? (
          <button
            type="button"
            onClick={onGo}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
          >
            Take me back
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            data-testid="walk-next"
            className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
          >
            {last ? "Finish" : "Next"}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The "Show me how" button: at the top right of the dashboard. Opens the list of guided jobs. */
export function ShowMeHowButton() {
  const { openPicker, available } = useWalkthrough();
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={openPicker}
      data-testid="show-me-how"
      className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-brand-200 bg-white px-4 text-sm font-bold text-brand-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50 print:hidden"
    >
      <GraduationCap className="h-4 w-4" aria-hidden="true" />
      Show me how
    </button>
  );
}

/** The walkthroughs as cards, for the Walkthroughs page. */
const readDone = () => {
  try {
    return localStorage.getItem(DONE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};

export function WalkthroughList({ allowed }: { allowed: string[] }) {
  const { start } = useWalkthrough();
  const done = JSON.parse(useSyncExternalStore(() => () => {}, readDone, () => "[]")) as string[];
  const list = WALKTHROUGHS.filter((w) => allowed.includes(w.id));
  if (!list.length) return <p className="text-sm text-slate-600">No walkthroughs for your role yet.</p>;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {list.map((w) => (
        <li key={w.id} className="flex flex-col rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
          <span className="flex items-center gap-2 text-lg font-extrabold text-brand-950">
            <GraduationCap className="h-5 w-5 text-brand-700" aria-hidden="true" />
            {w.title}
            {done.includes(w.id) ? <CheckCircle2 className="h-4 w-4 text-brand-600" aria-label="Done before" /> : null}
          </span>
          <span className="mt-1 flex-1 text-sm text-slate-600">{w.summary}</span>
          <span className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500">
              {w.steps.length} steps · about {w.minutes} min
            </span>
            <button
              type="button"
              onClick={() => start(w.id)}
              data-testid={`start-${w.id}`}
              className="inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
            >
              Start
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
