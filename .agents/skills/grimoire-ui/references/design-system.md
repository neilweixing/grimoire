# Grimoire Design System

This is the baseline for new and modified Grimoire UI. It translates the user's preference for ChatGPT-like readability and hierarchy into concrete project choices. These values are not presented as ChatGPT's measured or official specification.

Current implementation lives in `apps/grimoire-web/src/styles.css`. Some legacy selectors still use smaller fonts or isolated dimensions. Apply the baselines to the component family being changed; do not claim that this reference alone updates the application, and do not broaden a focused task into an unsolicited redesign.

## 1. Color roles

Keep the existing light, warm theme. Use its CSS custom properties rather than new per-page hex values.

| Token             | Current value | Role                                               |
| ----------------- | ------------- | -------------------------------------------------- |
| `--canvas`        | `#fcfaf7`     | Main application background                        |
| `--surface`       | `#fffdf9`     | Fields, dropdowns, dialogs, and raised content     |
| `--sidebar`       | `#f3eee7`     | Sidebar and settings navigation                    |
| `--ink`           | `#403830`     | Main content, titles, and important labels         |
| `--text`          | `#6c5c4e`     | Interface labels and ordinary secondary content    |
| `--muted`         | `#8b7c6e`     | Nonessential metadata and subdued icons            |
| `--border`        | `#e7dfd5`     | Dividers and control outlines                      |
| `--accent`        | `#a65f43`     | Primary actions and enabled switches               |
| `--accent-soft`   | `#f2e5da`     | Selected rows, hover surfaces, and subtle emphasis |
| `--accent-border` | `#d8b9a6`     | Interactive hover outlines                         |

The light appearance retains the warm values above. The dark appearance is inspired by [Atom One Dark](https://github.com/atom/one-dark-syntax/blob/master/styles/colors.less): canvas `#282c34`, sidebar/code `#21252b`, raised surface `#2c313a`, body text `#abb2bf`, and accent `#61afef`. Keep semantic roles for borders, hover, code, user bubbles, errors, warnings, on-accent text, focus, and overlays. Legacy light colors keep explicit fallbacks. Do not invert the page or inject theme styles into embedded websites.

Use the same role on every page: a settings panel must not invent a whiter background, a different brown for its labels, or a new accent. Use surface/background contrast and spacing for hierarchy; avoid a card around every group. Shadows belong to actual floating or modal layers.

For destructive actions, reuse `.error-banner`, `.danger-menu-item`, and `.confirm-danger` with their existing semantic treatment. Preserve the compact update action's deliberately deeper terracotta (`#8f4b34`). In the light appearance, neither a normal selection nor an update indicator becomes blue or green solely to stand out. Dark mode consistently uses its blue accent. Add a new semantic status color centrally only when the UI needs a distinct meaning; include an icon or text so color is not the only cue.

Essential text must remain readable: check normal text against a 4.5:1 contrast target and non-text control boundaries/focus against 3:1 where they convey state. If a muted treatment is insufficient, use `--text` or `--ink` for that content. Do not make required labels, errors, or unknown-capability explanations tiny and pale. Disabled controls are a separate state, not the palette for supporting content.

## 2. Typography across modules

Use one application font stack: `"DM Sans", "Noto Sans SC", sans-serif`, with usable system fallbacks. These are the existing product families. Avoid changing the typeface per module, adding a heading-only display font, or downloading an unofficial ChatGPT-branded font. Preserve useful rendering when a web font is unavailable.

Sizes are CSS pixels at normal browser zoom. Use weights supported by the font; ordinary content is 400, labels/actions may be 500, and headings may be 600. Do not bold whole settings pages or selected chat text to compensate for a missing layout hierarchy.

| Role                                    | Font size / line height | Weight  | Applies to                                              |
| --------------------------------------- | ----------------------- | ------- | ------------------------------------------------------- |
| Page title                              | 24 / 32                 | 600     | Standalone page heading                                 |
| Dialog or settings title                | 20 / 28                 | 600     | Modal title, settings content title                     |
| Content section title                   | 18 / 26                 | 500–600 | A major section within a content page                   |
| Small group heading                     | 14 / 20                 | 500–600 | General/Security groups and compact form groups         |
| Conversation body                       | 14 / 24                 | 400     | Both assistant replies and user messages                |
| Composer text                           | 14 / 22                 | 400     | Draft and placeholder                                   |
| Navigation                              | 13 / 20                 | 400–500 | New chat, Projects, Recent, Settings, project/chat rows |
| Settings rows and field labels          | 14 / 20                 | 400–500 | Labels, provider names, setting values                  |
| Buttons, inputs, selects, and menu rows | 14 / 20                 | 400–500 | Shared application controls                             |
| Supporting text                         | 12 / 18                 | 400     | Helpful hints, secondary paths, secondary model IDs     |
| Compact telemetry                       | 12 / 16                 | 400     | Token/speed/context metrics and short metadata          |

The user selected a denser desktop balance after reviewing the running app: sidebar labels are 13px and conversation/composer text is 14px, replacing the earlier 16px reading baseline. Reuse `--font-size-sidebar`, `--font-size-conversation`, `--line-height-conversation`, `--font-size-code`, and `--font-mono` for these roles. These are Grimoire choices, not official ChatGPT pixel values.

Equivalent navigation items share their size: Projects and Recent must not shrink below New chat or Settings. Input values and dropdown choices use the same role size. Supporting paths can be smaller than the name they qualify, but actions and required field labels are not footnotes. Avoid adding new 9–11px interface text.

Prefer role-based shared classes or semantic custom properties when consolidating these sizes. If a needed typography token does not exist in `styles.css`, define it centrally before referencing it. Do not invent unresolved `var(...)` names, add a new global `html` font size that scales unrelated controls, or copy a legacy 10px label into a new form.

### Conversation typography and Markdown

The main chat area is a reading surface. Use the same body family, size, and weight for user and assistant text; alignment and bubble treatment identify the speaker. Do not shrink user messages or make assistant text a different font.

| Content                                              | Baseline                              |
| ---------------------------------------------------- | ------------------------------------- |
| Paragraphs, lists, quotes, and normal table cells    | 14px; 24px line height                |
| Composer text and placeholder                        | 14px; 22px line height                |
| Markdown H1                                          | 24px / 32px; weight 600               |
| Markdown H2                                          | 20px / 28px; weight 600               |
| Markdown H3                                          | 18px / 26px; weight 600               |
| Markdown H4–H6                                       | 16px / 24px; weight 600               |
| Inline code                                          | 13px; inherit surrounding line height |
| Fenced code                                          | 13px / 20px; system monospace         |
| Code language/copy actions, source paths, timestamps | 12px / 18px                           |

Use `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace` for code, SQL, JSON, and terminal output. Keep prose out of monospace. Scope syntax highlighting to code and preserve meaningful colors without recoloring the entire chat surface.

- Give consecutive paragraphs 12px separation; use 8px between list items and 16–24px around headings, lists, quotes, tables, and code blocks. Avoid compounding container gaps with first/last-child margins.
- Keep message text left aligned, with natural Chinese wrapping and comfortable English line lengths. Aim for about 65–80 Latin characters per line; do not force a fixed character width onto Chinese text or a narrow viewport.
- Keep inline code compact with a subtle background and small inset. Fenced code can scroll horizontally; long URLs and prose wrap without widening the whole app.
- Wide tables scroll inside their own wrapper. Keep headings, paragraphs, table cells, and controls readable in both languages; do not scale the whole message down to fit a table.
- The composer starts without a visible scrollbar for an empty or short draft. Grow to its established height limit, then scroll inside it. Keep the surrounding model/permission controls and metrics aligned.
- A narrow window or open browser drawer reduces available width, not body font size. Wrap or reflow layout before reducing readable text. Preserve the existing right-aligned user bubbles and neutral assistant surface.

### Tool execution details

Keep the activity trace collapsed by default, with the answer outside it. Completed trace summaries use text and a disclosure chevron without a leading success icon. Show a leading state icon only while running, awaiting approval, or reporting an error. Individual calls also start collapsed. A shell summary shows a terminal icon, the actual command in 13px monospace, and a disclosure chevron. Other tool summaries show the operation and a meaningful path, URL, or query; Skill reads retain their localized label. Truncate the summary on one line while preserving the full value in the expanded details. Do not add a native title containing a full multiline command or output.

Use one warm surface panel for each expanded call: a 12px / 18px tool header, readable input, output, and a 12px / 18px state aligned at the bottom right. Shell input starts with `$ ` and output remains plain text rather than a JSON-quoted string. Other tools show readable parameters and formatted JSON when the value is structured. Present parameters and results as one continuous content area without separate Input/Output headings. Render all output as text, never executable HTML.

Use `--font-size-code` (13px), `--font-mono`, and 20px line height for commands and output. Cap the combined input/output viewport at 320px and allow internal horizontal/vertical scrolling; the header and status remain outside this viewport. Use the shared warm scrollbar treatment. Do not truncate the stored output, invent output before it arrives, or show success while a call is running, waiting for approval, interrupted, or failed. Mount details only when expanded, and preserve manual expansion during streamed updates.

## 3. Spacing and layout

Use a 4px base rhythm: 4, 8, 12, 16, 24, 32, and 48px. The existing 6px icon/text gap and 5px menu inset are deliberate compact exceptions. Avoid introducing unrelated values such as 13, 19, or 27px for each new panel.

| Relationship                                          | Baseline                            |
| ----------------------------------------------------- | ----------------------------------- |
| Icon and action text                                  | 6px gap                             |
| Label to control or name to meaningful secondary text | 8px gap                             |
| Related buttons or inline controls                    | 8px gap                             |
| Fields or related settings rows                       | 16px gap                            |
| Independent sections                                  | 24px gap                            |
| Page/dialog content padding                           | 24px desktop; 16px when constrained |
| Form columns                                          | 16px gap; stack when constrained    |
| Menu inset                                            | 5px around rows                     |
| Menu row padding                                      | 8px vertical, 12px horizontal       |

Left-align labels, inputs, headings, and lists to the same content edge. In settings rows, the label grows and the trailing control remains aligned with adjacent rows. General settings have no empty icon column. Let long translations wrap or stack their control rather than overlapping it.

Use `min-width: 0` in shrinking flex/grid content. Sidebar names and trigger values truncate with an ellipsis; preserve access to the full value when useful. Avoid clipping essential form errors or confirmation consequences. Drawer resizing must leave enough room for the composer controls and metrics; clamp width instead of hiding those controls.

### Scrollbars

Use the application-wide scrollbar rules from `styles.css`: thin native scrollbars, an 8px WebKit fallback, transparent tracks/corners, rounded warm thumbs, and stronger thumb color when the scroll container is hovered or focused. Reuse `--scrollbar-size`, `--scrollbar-thumb`, and `--scrollbar-thumb-hover`; the higher-contrast preference uses the existing text palette.

Keep this treatment consistent in the sidebar, chat viewport, settings, dropdown lists, and code/output panels. Do not give each area its own scrollbar color, hide scrolling with `scrollbar-width: none`, or change scrollbar width on hover. Style existing overflow; do not force `overflow: scroll` or add empty-draft composer scrollbars to make the style visible.

### Settings row spacing

In General settings, keep 16px of vertical space between adjacent preference rows, 12px between a category heading and its first row, and 24px before the next category. Align labels and controls vertically, and align controls to a common right edge. Do not stack outlined selects edge to edge or simulate separation with a new card/background. Preserve the same rhythm when labels wrap and in both languages and appearances.

## 4. Control geometry and icons

| Element                                       | Baseline                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| Standard single-line input, select, or button | 36px minimum height; 8px vertical and 12px horizontal padding as content allows |
| Compact composer control                      | 32px minimum height; 14px text                                                  |
| Default icon button                           | 32 × 32px target; centered icon                                                 |
| Icon with text                                | 16px icon; 6px gap; no icon shrink                                              |
| Standalone utility icon                       | 16–18px inside its button target                                                |
| Menu row                                      | At least 36px; same type size as its trigger                                    |
| Field/button radius                           | 8px                                                                             |
| Menu surface                                  | `--menu-radius` (10px) and `--menu-shadow`                                      |
| Menu row radius                               | `--menu-row-radius` (6px)                                                       |
| Dialog radius                                 | 16px; reuse the owning modal class                                              |
| Control borders                               | 1px using `--border`                                                            |

Use minimum heights rather than fixed heights that clip translations or browser text zoom. Compact sidebar/title-bar actions are established exceptions; preserve their usability and avoid reusing their tiny footprint in forms. Do not apply a field radius to message bubbles, the composer shell, switches, or the logo.

Use Lucide consistently. Set icon/text actions to `inline-flex`, `align-items: center`, `justify-content: center`, `gap: 6px`, and a deliberate line height. Icons use `display: block` and `flex-shrink: 0`. Do not compensate for baseline problems with per-button transforms or negative margins. Reload, refresh, browse, and save actions use this same alignment rule, including their spinning/loading state.

## 5. Control states

Apply the states that exist for the control's semantics. Selection, keyboard focus, pointer hover, and loading are different states; they must not share a single boolean or an indistinguishable visual treatment.

| State                   | Appearance                                             | Behavior and semantics                                                             |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Default                 | Role colors, neutral outline/surface                   | Stable size and clear label                                                        |
| Hover                   | Warm soft fill or accent border                        | Enabled controls only; no layout shift                                             |
| Pressed                 | Restrained stronger warm treatment                     | Clear immediately on release; no decorative scale bounce                           |
| Selected/expanded       | Warm highlight, selected indicator where appropriate   | `aria-selected`, `aria-checked`, `aria-pressed`, or `aria-expanded` as appropriate |
| Keyboard focus          | Visible accent outline or equivalent field border/ring | Reuse shared focus styles; do not remove an outline without an equivalent          |
| Disabled                | Existing subdued treatment                             | Actual disabled semantics; cannot activate; information remains understandable     |
| Loading/saving          | Spinner or progress in a reserved icon slot            | Preserve label width/height, prevent duplicate mutation, expose busy status        |
| Validation/server error | Existing semantic error styling near the field/action  | Describe the problem, preserve input, connect error text to its field              |
| Empty                   | Brief useful text and an action when available         | No fabricated entries, decorative status, or unnecessary card                      |
| Success                 | Updated value/state; concise feedback if needed        | Avoid a permanent extra banner after an ordinary toggle                            |

Use server-confirmed switch values or explicitly roll back a failed optimistic update. Keep focus and the entered value after failure. A destructive or permission confirmation stays open on error; non-cancellable pending mutations prevent duplicate confirm/close actions until completion. Use `role="switch"` with `aria-checked` for switches and provide accessible names for icon-only controls.

For menus, preserve the selected checkmark and distinguish keyboard-active rows. Support Arrow keys, Enter, Escape, outside click, and appropriate focus restoration. Search fields remain editable and do not intercept IME composition as selection. Popups fit within viewport margins and scroll internally; use the shared `Select` top-layer behavior inside a dialog.

Keep interaction transitions near 120–150ms and respect `prefers-reduced-motion`. Reserve continuous animation for meaningful progress; do not animate every settings card or invent a new entrance effect for each page.

## 6. Review before delivery

For actual component changes, inspect the default state and every relevant state in the table. Compare the touched component with its equivalent elsewhere, not just with its own previous screenshot.

- Check all relevant modules: sidebar, chat/composer, settings, provider/model menus, integration lists, and confirmation dialogs.
- Check English and Simplified Chinese, long model/project names, empty content, failure, disabled controls, and a pending action.
- Check a normal desktop window (for example 1280 × 900), a constrained window (for example 600 × 650), and the browser drawer open when it affects the component.
- Inspect text hierarchy and colors at normal zoom; verify icon/text centers, consistent field heights, row spacing, and no horizontal page overflow.
- For chat changes, inspect Chinese and English paragraphs, multiple headings, a nested list, a long URL, a wide table, code, and a multiline draft. Confirm user and assistant body sizes match.
- Navigate with the keyboard. Confirm that Escape dismisses the current popup before its parent modal and that focus returns to a useful control.
- Run applicable type checks, focused behavior checks, and formatting/build checks. Use isolated data for mutations. Report unverified platforms or exceptions.

Documentation-only edits need Skill validation, Markdown formatting, working reference links, and source checks, rather than starting the application or claiming a visual regression run. Keep stopped services stopped unless the user asks to start them.
