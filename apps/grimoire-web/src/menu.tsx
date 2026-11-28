import type { ComponentProps, KeyboardEvent } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Search as SearchIcon } from "lucide-react";

export const Root = Dropdown.Root;
export const Trigger = Dropdown.Trigger;
export const Sub = Dropdown.Sub;
export const RadioGroup = Dropdown.RadioGroup;

function searchableKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (event.nativeEvent.isComposing || event.target instanceof HTMLInputElement)
    return;
  const search = event.currentTarget.querySelector<HTMLInputElement>(
    ".cascade-menu-search input",
  );
  if (!search || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([data-disabled])',
    ),
  ];
  if (
    (event.key === "ArrowUp" && event.target === items[0]) ||
    (event.key === "ArrowDown" && event.target === items.at(-1))
  ) {
    event.preventDefault();
    event.stopPropagation();
    search.focus({ preventScroll: true });
  }
}

export function Content({
  className = "",
  ...props
}: ComponentProps<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        loop
        {...props}
        className={`cascade-menu ${className}`}
      />
    </Dropdown.Portal>
  );
}
export function SubContent({
  className = "",
  onKeyDownCapture,
  ...props
}: ComponentProps<typeof Dropdown.SubContent>) {
  return (
    <Dropdown.Portal>
      <Dropdown.SubContent
        sideOffset={4}
        alignOffset={-5}
        collisionPadding={12}
        loop
        {...props}
        className={`cascade-menu cascade-submenu ${className}`}
        onKeyDownCapture={(event) => {
          searchableKeyboard(event);
          if (!event.defaultPrevented) onKeyDownCapture?.(event);
        }}
      />
    </Dropdown.Portal>
  );
}
export function Item({
  className = "",
  ...props
}: ComponentProps<typeof Dropdown.Item>) {
  return (
    <Dropdown.Item {...props} className={`cascade-menu-item ${className}`} />
  );
}
export function SubTrigger({
  className = "",
  children,
  ...props
}: ComponentProps<typeof Dropdown.SubTrigger>) {
  return (
    <Dropdown.SubTrigger
      {...props}
      className={`cascade-menu-item cascade-menu-subtrigger ${className}`}
    >
      {children}
      <ChevronRight size={14} className="menu-sub-arrow" />
    </Dropdown.SubTrigger>
  );
}
export function RadioItem({
  className = "",
  children,
  ...props
}: ComponentProps<typeof Dropdown.RadioItem>) {
  return (
    <Dropdown.RadioItem {...props} className={`cascade-menu-item ${className}`}>
      {children}
      <Dropdown.ItemIndicator className="menu-check">
        <Check size={14} />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}
export function Label({
  className = "",
  ...props
}: ComponentProps<typeof Dropdown.Label>) {
  return (
    <Dropdown.Label {...props} className={`cascade-menu-label ${className}`} />
  );
}
export function Separator() {
  return <Dropdown.Separator className="cascade-menu-separator" />;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="cascade-menu-empty" role="status">
      {children}
    </div>
  );
}
export function Search({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="cascade-menu-search">
      <SearchIcon size={14} />
      <input
        type="text"
        value={value}
        aria-label={label}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") return;
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const items = [
              ...event.currentTarget
                .closest('[role="menu"]')!
                .querySelectorAll<HTMLElement>(
                  '[role^="menuitem"]:not([data-disabled])',
                ),
            ];
            (event.key === "ArrowUp" ? items.at(-1) : items[0])?.focus({
              preventScroll: true,
            });
          } else if (event.key === "Enter") event.preventDefault();
        }}
      />
    </div>
  );
}
