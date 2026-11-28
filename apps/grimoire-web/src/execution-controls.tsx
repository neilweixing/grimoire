import { useEffect, useRef, useState } from "react";
import {
  usePiRuntimeExtras,
  type PiHostUiResponse,
} from "@assistant-ui/react-pi";
import {
  Check,
  ChevronDown,
  Eye,
  ShieldCheck,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { ExecutionSettings, PermissionMode } from "@grimoire/core";
import { useWorkspace, workspaceApi } from "./workspace";
import { Select } from "./select";
import { Tooltip } from "./tooltip";
import { ConfirmDialog } from "./confirm-dialog";
import { useI18n } from "./i18n";

export function ExecutionControls({
  ensureThread,
}: {
  ensureThread: () => Promise<string>;
}) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const { metadata, status, refresh } = usePiRuntimeExtras();
  const [execution, setExecution] = useState<ExecutionSettings>();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const modeTrigger = useRef<HTMLButtonElement>(null);
  const validId = metadata.id && !metadata.id.startsWith("__");
  useEffect(() => {
    if (pending) return;
    const controller = new AbortController();
    if (!confirmFullAccess) setError("");
    void workspaceApi<ExecutionSettings>(
      workspace.id,
      validId ? `/pi/threads/${metadata.id}/execution` : "/pi/execution",
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setExecution(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [metadata.id, pending, workspace.id, confirmFullAccess]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const labels: Record<PermissionMode, string> = {
    "read-only": t("permissionReadOnly"),
    workspace: t("permissionWorkspace"),
    full: t("permissionFull"),
  };
  const mode = execution?.mode ?? "workspace";
  const icons = { "read-only": Eye, workspace: ShieldCheck, full: ShieldAlert };
  const ModeIcon = icons[mode];
  const select = async (mode: PermissionMode) => {
    const acknowledgeFullAccess = mode === "full";
    setPending(true);
    setError("");
    try {
      const id = await ensureThread();
      setExecution(
        await workspaceApi<ExecutionSettings>(
          workspace.id,
          `/pi/threads/${id}/execution`,
          {
            method: "PUT",
            body: JSON.stringify({ mode, acknowledgeFullAccess }),
          },
        ),
      );
      await refresh();
      setOpen(false);
      setConfirmFullAccess(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("requestFailed"));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="execution-picker" ref={root}>
      <Tooltip
        content={
          <>
            <strong>{labels[mode]}</strong>
            <span>
              {t(
                mode === "full"
                  ? "permissionFullHint"
                  : mode === "read-only"
                    ? "permissionReadOnlyHint"
                    : "permissionWorkspaceHint",
              )}
            </span>
          </>
        }
      >
        <button
          type="button"
          ref={modeTrigger}
          className="execution-mode"
          aria-label={`${t("permissions")}: ${labels[mode]}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ModeIcon size={16} aria-hidden="true" />
          <span className="execution-label">{labels[mode]}</span>
          <ChevronDown
            size={11}
            className={`execution-chevron ${open ? "chevron-open" : ""}`}
            aria-hidden="true"
          />
        </button>
      </Tooltip>
      {open && (
        <div
          className="execution-menu"
          role="menu"
          aria-label={t("permissions")}
        >
          {(["read-only", "workspace", "full"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={execution?.mode === mode}
              disabled={
                pending ||
                status === "running" ||
                !execution ||
                (mode === "full" && !execution.fullAccessAvailable)
              }
              title={t(
                mode === "full"
                  ? "permissionFullHint"
                  : mode === "read-only"
                    ? "permissionReadOnlyHint"
                    : "permissionWorkspaceHint",
              )}
              onClick={() => {
                if (mode === "full" && execution?.mode !== "full") {
                  setOpen(false);
                  setError("");
                  setConfirmFullAccess(true);
                } else void select(mode);
              }}
            >
              {(() => {
                const Icon = icons[mode];
                return <Icon size={14} />;
              })()}
              <span>{labels[mode]}</span>
              {execution?.mode === mode && <Check size={14} />}
            </button>
          ))}
          {!execution?.shellAvailable && (
            <p>
              <TriangleAlert size={12} /> {t("sandboxUnavailable")}
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmFullAccess}
        title={t("permissionFull")}
        description={t("permissionFullConfirm")}
        confirmLabel={t("enableFullAccess")}
        pending={pending}
        error={error}
        icon={ShieldAlert}
        tone="primary"
        onCancel={() => {
          setConfirmFullAccess(false);
          requestAnimationFrame(() => modeTrigger.current?.focus());
        }}
        onConfirm={() => void select("full")}
      />
    </div>
  );
}

export function ApprovalRequests() {
  const { t } = useI18n();
  const { allHostUiRequests, respondToHostUiRequest } = usePiRuntimeExtras();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const answer = async (response: PiHostUiResponse) => {
    const requestId = response.requestId;
    setPending(requestId);
    setError("");
    try {
      await respondToHostUiRequest(response);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("requestFailed"));
    } finally {
      setPending(undefined);
    }
  };
  return (
    <div className="approval-requests" aria-live="polite">
      {allHostUiRequests.map((request) => (
        <section className="approval-card" key={request.id}>
          <strong>
            <ShieldCheck size={16} />
            {request.kind === "confirm" ? t("approvalRequired") : request.title}
          </strong>
          {request.kind === "confirm" && <pre>{request.message}</pre>}
          {request.kind === "input" && (
            <input
              className="host-ui-input"
              aria-label={request.title}
              placeholder={request.placeholder}
              value={values[request.id] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [request.id]: e.target.value })
              }
            />
          )}
          {request.kind === "editor" && (
            <textarea
              className="host-ui-input"
              rows={4}
              aria-label={request.title}
              value={values[request.id] ?? request.prefill ?? ""}
              onChange={(e) =>
                setValues({ ...values, [request.id]: e.target.value })
              }
            />
          )}
          {request.kind === "select" && (
            <Select
              label={request.title}
              value={values[request.id] ?? ""}
              disabled={pending === request.id}
              placeholder={t("selectOption")}
              options={request.options.map((option) => ({
                value: option,
                label: option,
              }))}
              onChange={(value) =>
                setValues({ ...values, [request.id]: value })
              }
            />
          )}

          <div className="approval-actions">
            <button
              type="button"
              disabled={pending === request.id}
              onClick={() =>
                void answer(
                  request.kind === "confirm"
                    ? { requestId: request.id, confirmed: false }
                    : { requestId: request.id, dismissed: true },
                )
              }
            >
              {request.kind === "confirm" ? t("deny") : t("cancel")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                pending === request.id ||
                (request.kind === "select" && !values[request.id])
              }
              onClick={() =>
                void answer(
                  request.kind === "confirm"
                    ? { requestId: request.id, confirmed: true }
                    : {
                        requestId: request.id,
                        value:
                          values[request.id] ??
                          (request.kind === "editor"
                            ? (request.prefill ?? "")
                            : ""),
                      },
                )
              }
            >
              {request.kind === "confirm"
                ? t("approveOnce")
                : t("continueAction")}
            </button>
          </div>
        </section>
      ))}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
