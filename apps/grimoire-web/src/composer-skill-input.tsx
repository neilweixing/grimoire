import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ComposerPrimitive,
  useAuiState,
  unstable_useTriggerPopoverScopeContext,
} from "@assistant-ui/react";
import { BookOpen } from "lucide-react";
import { useI18n } from "./i18n";
import { useComposerSkills } from "./composer-skills";
import {
  SKILL_TRIGGER,
  matchSkillTrigger,
  skillCompletionAdapter,
  skillFormatter,
} from "./skill-completion";

function SkillSuggestions({
  input,
  popup,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  popup: HTMLDivElement | null;
}) {
  const { t } = useI18n();
  const scope = unstable_useTriggerPopoverScopeContext();
  const { skills, pending, error, reload } = useComposerSkills();
  const { open, close, highlightedItemId } = scope;
  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);
  useLayoutEffect(() => {
    const element = popup;
    if (!open || !element) return;
    const place = () => {
      const anchor = input.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(360, window.innerWidth - 24);
      const above = anchor.top - 20;
      const below = window.innerHeight - anchor.bottom - 20;
      const upwards = above >= below;
      Object.assign(element.style, {
        width: `${width}px`,
        maxHeight: `${Math.max(60, Math.min(320, upwards ? above : below))}px`,
        left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`,
        top: upwards ? "auto" : `${anchor.bottom + 8}px`,
        bottom: upwards ? `${window.innerHeight - anchor.top + 8}px` : "auto",
      });
    };
    element.showPopover();
    place();
    const scroll = (event: Event) => {
      if (!element.contains(event.target as Node)) place();
    };
    window.addEventListener("resize", place);
    document.addEventListener("scroll", scroll, true);
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (
        event.target !== input.current &&
        !element.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      if (element.isConnected && element.matches(":popover-open"))
        element.hidePopover();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open, input, popup, close]);
  useEffect(() => {
    if (open && highlightedItemId)
      document
        .getElementById(highlightedItemId)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedItemId]);
  if (!open) return null;
  if (pending || error)
    return (
      <div
        className={`skill-completion-status ${error ? "error-text" : ""}`}
        role="status"
      >
        {t(error ? "skillsLoadFailed" : "skillsLoading")}
      </div>
    );
  return (
    <ComposerPrimitive.TriggerPopoverItems
      className="skill-completion-items"
      aria-label={t("useSkill")}
    >
      {(items) =>
        items.length ? (
          items.map((item, index) => (
            <ComposerPrimitive.TriggerPopoverItem
              key={item.id}
              item={item}
              index={index}
              tabIndex={-1}
              className="skill-completion-item"
              onMouseDown={(event) => event.preventDefault()}
            >
              <BookOpen size={16} />
              <span className="menu-item-copy">
                <span className="menu-item-label">/skill:{item.id}</span>
                {item.description && (
                  <span className="menu-item-description">
                    {item.description}
                  </span>
                )}
              </span>
            </ComposerPrimitive.TriggerPopoverItem>
          ))
        ) : (
          <div className="skill-completion-status" role="status">
            {t(skills.length ? "noMatchingOptions" : "noAvailableSkills")}
          </div>
        )
      }
    </ComposerPrimitive.TriggerPopoverItems>
  );
}

export function ComposerSkillInput({
  disabled,
  placeholder,
}: {
  disabled: boolean;
  placeholder: string;
}) {
  const { t } = useI18n();
  const { skills, pending } = useComposerSkills();
  const text = useAuiState((state) => state.composer.text);
  const [composing, setComposing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const adapter = useMemo(() => skillCompletionAdapter(skills), [skills]);
  const command = text.match(/^\/skill:([^\s]+)/u);
  const token =
    command && skills.some((skill) => skill.name === command[1])
      ? command[0]
      : "";
  // The overlay is visual only; Pi and the native input retain the original text.
  // Show the native text during IME composition so pre-edit characters stay visible.
  const highlighted = Boolean(token) && !composing;
  const sync = () => {
    if (!input.current || !highlight.current) return;
    highlight.current.style.width = `${input.current.clientWidth}px`;
    highlight.current.style.height = `${input.current.clientHeight}px`;
    highlight.current.scrollTop = input.current.scrollTop;
    highlight.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(sync, [text, highlighted]);
  useEffect(() => {
    if (!input.current) return;
    const observer = new ResizeObserver(sync);
    observer.observe(input.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={`composer-editor ${highlighted ? "has-skill-highlight" : ""}`}
      onCompositionStartCapture={() => setComposing(true)}
      onCompositionEndCapture={() => setComposing(false)}
      onBlurCapture={() => setComposing(false)}
    >
      {highlighted && (
        <div
          className="composer-input-highlight"
          ref={highlight}
          aria-hidden="true"
        >
          <mark>{token}</mark>
          {text.slice(token.length)}
          {text.endsWith("\n") ? "\u200b" : ""}
        </div>
      )}
      <ComposerPrimitive.Input
        ref={input}
        autoFocus
        disabled={disabled}
        className="composer-input"
        placeholder={placeholder}
        aria-label={t("placeholder")}
        minRows={1}
        maxRows={7}
        onScroll={sync}
        onHeightChange={(height) => {
          if (input.current)
            input.current.style.overflowY = height >= 168 ? "auto" : "hidden";
          sync();
        }}
      />
      <ComposerPrimitive.TriggerPopover
        char={SKILL_TRIGGER}
        matcher={matchSkillTrigger}
        adapter={adapter}
        isLoading={pending}
        ref={setPopup}
        popover="manual"
        className="skill-autocomplete"
        aria-label={t("useSkill")}
      >
        <ComposerPrimitive.TriggerPopover.Directive
          formatter={skillFormatter}
          onInserted={(item) =>
            requestAnimationFrame(() => {
              const element = input.current;
              if (!element) return;
              element.focus({ preventScroll: true });
              const cursor = `/skill:${item.id} `.length;
              element.setSelectionRange(cursor, cursor);
            })
          }
        />
        <SkillSuggestions input={input} popup={popup} />
      </ComposerPrimitive.TriggerPopover>
    </div>
  );
}
