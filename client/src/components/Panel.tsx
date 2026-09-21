import type { ReactNode } from "react";

export function Panel({
  title,
  chip,
  actions,
  flush = false,
  children,
}: {
  title: ReactNode;
  chip?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">
          {title}
          {chip}
        </h2>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>{children}</div>
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <div className="panel__empty">{children}</div>;
}
