import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useI18n } from "./i18n";

type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function Select({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled = false,
  searchable = false,
  allowCustom = false,
  id,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  allowCustom?: boolean;
  id?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    `${option.label} ${option.value} ${option.description ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const choices: SelectOption[] = [...filtered];
  if (
    allowCustom &&
    query.trim() &&
    query.trim().length <= 200 &&
    !options.some((option) => option.value === query.trim())
  )
    choices.push({
      value: query.trim(),
      label: query.trim(),
      description: t("customModelId"),
    });
  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const show = () => {
    if (disabled || trigger.current?.matches(":disabled")) return;
    setQuery("");
    const index = options.findIndex(
      (option) => option.value === value && !option.disabled,
    );
    setActive(
      index >= 0
        ? index
        : Math.max(
            0,
            options.findIndex((option) => !option.disabled),
          ),
    );
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const element = popup.current;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(
        Math.max(rect.width, searchable ? 260 : 180),
        window.innerWidth - 24,
      );
      const anchorTop = Math.max(
        12,
        Math.min(rect.top, window.innerHeight - 12),
      );
      const anchorBottom = Math.max(
        12,
        Math.min(rect.bottom, window.innerHeight - 12),
      );
      const below = window.innerHeight - anchorBottom - 14;
      const above = anchorTop - 14;
      const upwards = below < 240 && above > below;
      const height = Math.min(340, Math.max(80, upwards ? above : below));
      Object.assign(element.style, {
        width: `${width}px`,
        maxHeight: `${height}px`,
        left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
        top: upwards ? "auto" : `${anchorBottom + 6}px`,
        bottom: upwards ? `${window.innerHeight - anchorTop + 6}px` : "auto",
      });
    };
    element.showPopover();
    place();
    (searchable ? search.current : list.current)?.focus({
      preventScroll: true,
    });
    const scroll = (event: Event) => {
      if (!element.contains(event.target as Node)) place();
    };
    window.addEventListener("resize", place);
    document.addEventListener("scroll", scroll, true);
    return () => {
      if (element.isConnected && element.matches(":popover-open"))
        element.hidePopover();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open && disabled) setOpen(false);
  }, [disabled, open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${uid}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, uid]);
  const keyboard = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const enabled = choices
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const current = enabled.indexOf(active);
      const next = current + (event.key === "ArrowDown" ? 1 : -1);
      setActive(enabled[(next + enabled.length) % enabled.length] ?? 0);
    } else if (
      event.key === "Enter" ||
      (event.key === " " && event.target !== search.current)
    ) {
      event.preventDefault();
      if (choices[active]) choose(choices[active]);
    } else if (
      event.target !== search.current &&
      (event.key === "Home" || event.key === "End")
    ) {
      event.preventDefault();
      setActive(
        event.key === "Home" ? (enabled[0] ?? 0) : (enabled.at(-1) ?? 0),
      );
    }
  };
  return (
    <div
      className={`select-control ${className}`}
      ref={root}
      onKeyDown={keyboard}
    >
      <button
        type="button"
        id={id}
        ref={trigger}
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${uid}-list`}
        disabled={disabled}
        title={selected?.label || value}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className={!value ? "select-placeholder" : ""}>
          {selected?.label || value || placeholder || t("selectOption")}
        </span>
        <ChevronDown size={14} className={open ? "chevron-open" : ""} />
      </button>
      {open && (
        <div ref={popup} popover="manual" className="select-popup">
          {searchable && (
            <div className="select-search">
              <Search size={14} />
              <input
                ref={search}
                value={query}
                aria-label={t("searchOptions")}
                aria-controls={`${uid}-list`}
                aria-activedescendant={
                  choices[active] ? `${uid}-option-${active}` : undefined
                }
                placeholder={
                  allowCustom ? t("enterOrSelectModel") : t("searchOptions")
                }
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
            </div>
          )}
          <div
            id={`${uid}-list`}
            ref={list}
            className="select-options"
            role="listbox"
            tabIndex={searchable ? -1 : 0}
            aria-label={label}
            aria-activedescendant={
              choices[active] ? `${uid}-option-${active}` : undefined
            }
          >
            {choices.map((option, index) => (
              <button
                type="button"
                id={`${uid}-option-${index}`}
                key={option.value}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                className={`select-option ${active === index ? "is-highlighted" : ""}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
                title={option.label}
              >
                <span>
                  <span className="select-option-label">{option.label}</span>
                  {option.description && (
                    <span className="select-option-description">
                      {option.description}
                    </span>
                  )}
                </span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
            {!choices.length && (
              <p className="select-empty">
                {allowCustom ? t("enterOrSelectModel") : t("noMatchingOptions")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
