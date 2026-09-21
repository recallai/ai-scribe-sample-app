import { NOTE_FORMAT_LABEL, STATUS_LABEL, formatDateTime, initials } from "../format";
import type { VisitView } from "../types";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";

export function VisitSidebar({
  visits,
  selectedId,
  onSelect,
  onNew,
}: {
  visits: VisitView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const sorted = [...visits].sort(
    (a, b) => Date.parse(b.joinAt ?? b.createdAt) - Date.parse(a.joinAt ?? a.createdAt),
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div>
          <h2>Visits</h2>
        </div>
        <button type="button" className="btn btn--primary btn--sm" onClick={onNew}>
          <Icon name="plus" size={14} />
          New visit
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="sidebar__empty">No visits yet.</div>
      ) : (
        <ul className="sidebar__list">
          {sorted.map((visit) => (
            <li key={visit.id}>
              <button
                type="button"
                className={`visit-item${visit.id === selectedId ? " visit-item--active" : ""}`}
                aria-label={`${visit.title || visit.patientName}, ${STATUS_LABEL[visit.status]}`}
                aria-current={visit.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(visit.id)}
              >
                <span className="avatar">{initials(visit.title || visit.patientName)}</span>
                <span className="visit-item__body">
                  <span className="visit-item__row">
                    <span className="visit-item__name">{visit.title || visit.patientName}</span>
                    <StatusBadge status={visit.status} />
                  </span>
                  <span className="visit-item__meta">
                    <span>{formatDateTime(visit.joinAt ?? visit.createdAt)}</span>
                    {visit.note ? (
                      <>
                        <span>·</span>
                        <span>{NOTE_FORMAT_LABEL[visit.note.format]} note</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
