export type ToastState = { message: string; kind: "info" | "error" } | null;

export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div className={`toast${toast.kind === "error" ? " toast--error" : ""}`} role="status">
      {toast.message}
    </div>
  );
}
