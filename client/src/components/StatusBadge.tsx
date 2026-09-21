import { STATUS_LABEL } from "../format";
import type { VisitStatus } from "../types";

export function StatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span className={`badge badge--${status}`}>
      <span className="badge__dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}
