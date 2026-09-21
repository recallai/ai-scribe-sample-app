import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Icon } from "./components/Icon";
import { CalendarView } from "./components/CalendarView";
import { NewVisitDialog } from "./components/NewVisitDialog";
import { Toast } from "./components/Toast";
import type { ToastState } from "./components/Toast";
import { VisitDetail } from "./components/VisitDetail";
import type { BotAction } from "./components/VisitDetail";
import { VisitSidebar } from "./components/VisitSidebar";
import type { NewVisitInput, NoteFormat, VisitView } from "./types";

const POLL_MS = 4000;

type View = "visits" | "calendar";

export function App() {
  const [view, setView] = useState<View>("visits");
  const [visits, setVisits] = useState<VisitView[]>([]);
  const [visitsError, setVisitsError] = useState<string | null>(null);
  const [defaultFormat, setDefaultFormat] = useState<NoteFormat>("soap");
  const [defaultRecordVideo, setDefaultRecordVideo] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recording, setRecording] = useState<{
    visitId: string;
    recordingId: string;
    url: string | null;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const selectedVisit = visits.find((visit) => visit.id === selectedId) ?? null;
  const selectedRecordingId = selectedVisit?.recordingId;

  const notify = useCallback((message: string, kind: "info" | "error" = "info") => {
    setToast({ message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === "error" ? 6000 : 3000);
  }, []);

  const notifyError = useCallback((message: string) => notify(message, "error"), [notify]);

  const loadVisits = useCallback(async () => {
    try {
      setVisits(await api.listVisits());
      setVisitsError(null);
    } catch (error) {
      setVisitsError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    api.config().then(
      (config) => {
        setDefaultFormat(config.noteFormat);
        setDefaultRecordVideo(config.recordVideo);
      },
      (error) => notifyError(error instanceof Error ? error.message : String(error)),
    );
  }, [notifyError]);

  // The server pushes nothing to the browser; a light poll keeps the visit
  // list and the selected visit in sync as Recall webhooks land.
  useEffect(() => {
    void loadVisits();
    const timer = window.setInterval(() => void loadVisits(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadVisits]);

  // The OAuth callback lands back here with ?view=calendar and either a
  // connected calendar ID or an error. Read it once, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "calendar") setView("calendar");
    const error = params.get("calendarError");
    if (error) notify(error, "error");
    else if (params.get("calendar")) notify("Calendar connected.");
    if ([...params.keys()].length) window.history.replaceState(null, "", window.location.pathname);
  }, [notify]);

  useEffect(() => {
    setRecording(null);
    if (!selectedId || !selectedRecordingId) return;
    let cancelled = false;
    api.getVisit(selectedId).then(
      (visit) => {
        if (!cancelled) {
          setRecording({
            visitId: selectedId,
            recordingId: selectedRecordingId,
            url: visit.recordingUrl ?? null,
          });
        }
      },
      (error) => {
        if (!cancelled) notify(error instanceof Error ? error.message : String(error), "error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedRecordingId, notify]);

  function mergeVisit(visit: VisitView) {
    setVisits((current) => {
      const index = current.findIndex((v) => v.id === visit.id);
      if (index === -1) return [...current, visit];
      const next = current.slice();
      next[index] = visit;
      return next;
    });
  }

  async function createVisit(input: NewVisitInput) {
    try {
      const visit = await api.createVisit(input);
      mergeVisit(visit);
      setSelectedId(visit.id);
      setDialogOpen(false);
      setView("visits");
      notify(visit.joinAt ? "Bot scheduled for the visit." : "Bot is joining the visit now.");
    } catch (err) {
      // A 502 still returns the saved visit so the failure is visible in the list.
      const body = (err as { body?: VisitView }).body;
      if (body && typeof body === "object" && "id" in body) {
        mergeVisit(body);
        setSelectedId(body.id);
        setDialogOpen(false);
      }
      throw err;
    }
  }

  async function run<T>(label: string, work: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(label);
    try {
      const result = await work();
      if (success) notify(success);
      return result;
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const selected = selectedVisit && {
    ...selectedVisit,
    recordingUrl:
      recording?.visitId === selectedVisit.id && recording.recordingId === selectedVisit.recordingId
        ? recording.url
        : null,
  };

  async function botAction(action: BotAction) {
    if (!selected) return;
    const labels: Record<BotAction, string> = {
      pause: "Recording paused.",
      resume: "Recording resumed.",
      leave: "Bot is leaving the call.",
    };
    await run(action, () => api.botAction(selected.id, action), labels[action]);
    await loadVisits();
  }

  async function cancelVisit() {
    if (!selected) return;
    const visit = await run("cancel", () => api.cancelVisit(selected.id), "Visit cancelled.");
    if (visit) mergeVisit(visit);
  }

  async function regenerateNote(format: NoteFormat) {
    if (!selected) return;
    const visit = await run("note", () => api.regenerateNote(selected.id, format));
    if (visit) {
      mergeVisit(visit);
      if (visit.aiError) notifyError(`Note generation failed: ${visit.aiError.message}`);
      else notify("Note regenerated.");
    }
  }

  function openVisit(id: string) {
    setSelectedId(id);
    setView("visits");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">
            <Icon name="logo" size={16} />
          </span>
          AI Scribe Sample Application
        </div>
        <nav className="topbar__nav" aria-label="Primary">
          <button
            type="button"
            className={`topbar__tab${view === "visits" ? " topbar__tab--active" : ""}`}
            onClick={() => setView("visits")}
          >
            Visits
          </button>
          <button
            type="button"
            className={`topbar__tab${view === "calendar" ? " topbar__tab--active" : ""}`}
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
        </nav>
      </header>
      {visitsError ? <div className="banner banner--danger">Could not load visits: {visitsError}</div> : null}

      {view === "visits" ? (
        <div className={`workspace${selected ? "" : " workspace--list"}`}>
          <VisitSidebar
            visits={visits}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setDialogOpen(true)}
          />
          <main className="main">
            {selected ? (
              <VisitDetail
                visit={selected}
                busy={busy}
                onBot={botAction}
                onCancel={cancelVisit}
                onRegenerate={regenerateNote}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="main__empty">
                <div>
                  <h2>{visits.length ? "Select a visit" : "No visits"}</h2>
                  {!visits.length ? (
                    <p style={{ marginTop: 16 }}>
                      <button type="button" className="btn btn--primary" onClick={() => setDialogOpen(true)}>
                        <Icon name="plus" size={14} />
                        New visit
                      </button>
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </main>
        </div>
      ) : (
        <main className="main">
          <CalendarView
            defaultFormat={defaultFormat}
            defaultRecordVideo={defaultRecordVideo}
            onOpenVisit={openVisit}
            onError={notifyError}
          />
        </main>
      )}

      {view === "visits" && <NewVisitDialog
        open={dialogOpen}
        defaultFormat={defaultFormat}
        defaultRecordVideo={defaultRecordVideo}
        onClose={() => setDialogOpen(false)}
        onSubmit={createVisit}
      />}

      <Toast toast={toast} />
    </div>
  );
}
