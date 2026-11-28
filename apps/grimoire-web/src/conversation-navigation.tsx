import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAuiState } from "@assistant-ui/react";
import { conversationTurns } from "./conversation-turns";
import { useI18n } from "./i18n";

export function ConversationNavigation({
  viewport,
}: {
  viewport: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const messages = useAuiState((state) => state.thread.messages);
  const turns = useMemo(() => conversationTurns(messages), [messages]);
  const [activeId, setActiveId] = useState<string>();
  const [preview, setPreview] = useState<{ id: string; top: number }>();
  const rail = useRef<HTMLDivElement>(null);
  const ids = turns.map((turn) => turn.id).join("\n");
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const nodes = Array.from(
        element.querySelectorAll<HTMLElement>("[data-turn-id]"),
      );
      const edge =
        element.getBoundingClientRect().top + element.clientHeight * 0.25;
      let current = nodes[0]?.dataset.turnId;
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= edge)
          current = node.dataset.turnId;
        else break;
      }
      if (element.scrollHeight - element.clientHeight - element.scrollTop <= 4)
        current = nodes.at(-1)?.dataset.turnId;
      setActiveId(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const content = element.querySelector(".messages");
    if (content) observer.observe(content);
    schedule();
    setPreview(undefined);
    return () => {
      element.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [viewport, ids]);
  useEffect(() => {
    const current = rail.current?.querySelector<HTMLElement>("[aria-current]");
    if (!current || !rail.current) return;
    if (current.offsetTop < rail.current.scrollTop)
      rail.current.scrollTop = current.offsetTop;
    else if (
      current.offsetTop + current.offsetHeight >
      rail.current.scrollTop + rail.current.clientHeight
    )
      rail.current.scrollTop =
        current.offsetTop + current.offsetHeight - rail.current.clientHeight;
  }, [activeId]);
  if (turns.length < 2) return null;
  const selected = turns.find((turn) => turn.id === preview?.id);
  const showPreview = (id: string, element: HTMLElement) => {
    const container = viewport.current?.parentElement;
    if (!container) return;
    const top =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    setPreview({
      id,
      top: Math.max(8, Math.min(top - 48, container.clientHeight - 160)),
    });
  };
  const jump = (id: string) => {
    const element = viewport.current;
    const target = element?.querySelector<HTMLElement>(
      `[data-turn-id="${CSS.escape(id)}"]`,
    );
    if (!element || !target) return;
    element.scrollTo({
      top: Math.max(
        0,
        element.scrollTop +
          target.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          16,
      ),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    setActiveId(id);
  };
  return (
    <>
      <nav
        className="conversation-navigation"
        style={{ height: `min(70%, ${turns.length * 18 + 8}px)` }}
        aria-label={t("conversationNavigation")}
        onMouseLeave={() => setPreview(undefined)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setPreview(undefined);
        }}
      >
        <div className="conversation-navigation-items" ref={rail}>
          {turns.map((turn, index) => (
            <button
              type="button"
              key={turn.id}
              aria-current={turn.id === activeId ? "step" : undefined}
              aria-label={`${t("jumpToTurn").replace("{number}", String(index + 1))}: ${turn.query.slice(0, 120)}`}
              aria-describedby={
                preview?.id === turn.id
                  ? "conversation-turn-preview"
                  : undefined
              }
              onMouseEnter={(event) =>
                showPreview(turn.id, event.currentTarget)
              }
              onFocus={(event) => showPreview(turn.id, event.currentTarget)}
              onClick={() => jump(turn.id)}
              onKeyDown={(event) => {
                const buttons = Array.from(
                  rail.current?.querySelectorAll("button") ?? [],
                );
                const next =
                  event.key === "ArrowDown"
                    ? Math.min(index + 1, turns.length - 1)
                    : event.key === "ArrowUp"
                      ? Math.max(index - 1, 0)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? turns.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  buttons[next]?.focus();
                }
                if (event.key === "Escape") setPreview(undefined);
              }}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </nav>
      {selected && preview && (
        <div
          id="conversation-turn-preview"
          className="conversation-turn-preview"
          role="tooltip"
          style={{ top: preview.top }}
        >
          <strong>
            {selected.query ||
              t("jumpToTurn").replace(
                "{number}",
                String(turns.indexOf(selected) + 1),
              )}
          </strong>
          {selected.answer && <p>{selected.answer}</p>}
        </div>
      )}
    </>
  );
}
