import { useRef, useState } from "react";
import { ComposerPrimitive, useAui } from "@assistant-ui/react";
import { BookOpen, Paperclip, Plus } from "lucide-react";
import { useI18n } from "./i18n";
import * as Menu from "./menu";
import { useComposerSkills } from "./composer-skills";

export function ComposerActions() {
  const { t } = useI18n();
  const aui = useAui();
  const { skills, pending, error, reload } = useComposerSkills();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const focusComposer = useRef(false);
  const fileButton = useRef<HTMLButtonElement>(null);
  const choices = skills.filter((skill) =>
    `${skill.name} ${skill.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setQuery("");
          void reload();
        }
      }}
    >
      {/* Keep the chooser mounted while the menu closes and the OS dialog is open. */}
      <ComposerPrimitive.AddAttachment
        ref={fileButton}
        hidden
        tabIndex={-1}
        aria-hidden="true"
      />
      <Menu.Trigger asChild>
        <button
          type="button"
          className="composer-more"
          aria-label={t("moreActions")}
          title={t("moreActions")}
        >
          <Plus size={18} />
        </button>
      </Menu.Trigger>
      <Menu.Content
        className="composer-action-menu"
        align="start"
        aria-label={t("moreActions")}
        onCloseAutoFocus={(event) => {
          if (focusComposer.current) {
            event.preventDefault();
            focusComposer.current = false;
            document
              .querySelector<HTMLTextAreaElement>(".composer-input")
              ?.focus();
          }
        }}
      >
        <Menu.Item onSelect={() => fileButton.current?.click()}>
          <Paperclip size={16} />
          <span className="menu-item-label">{t("addLocalFiles")}</span>
        </Menu.Item>
        <Menu.Sub onOpenChange={() => setQuery("")}>
          <Menu.SubTrigger
            className="composer-skill-trigger"
            disabled={pending || !skills.length}
          >
            <BookOpen size={16} />
            <span className="menu-item-label">
              {t(
                pending
                  ? "skillsLoading"
                  : skills.length
                    ? "useSkill"
                    : "noAvailableSkills",
              )}
            </span>
          </Menu.SubTrigger>
          <Menu.SubContent
            className="composer-skill-menu"
            aria-label={t("useSkill")}
          >
            <Menu.Search
              value={query}
              onChange={setQuery}
              label={t("searchOptions")}
            />
            <div className="cascade-menu-list">
              {choices.map((skill) => (
                <Menu.Item
                  key={skill.name}
                  textValue={skill.name}
                  onSelect={() => {
                    const draft = aui.composer.getState().text;
                    aui.composer.setText(
                      `/skill:${skill.name} ${draft.replace(/^\/skill:\S+\s*/, "")}`,
                    );
                    focusComposer.current = true;
                    setOpen(false);
                  }}
                >
                  <span className="menu-item-copy">
                    <span className="menu-item-label">{skill.name}</span>
                    {skill.description && (
                      <span className="menu-item-description">
                        {skill.description}
                      </span>
                    )}
                  </span>
                </Menu.Item>
              ))}
              {!choices.length && (
                <Menu.Empty>{t("noMatchingOptions")}</Menu.Empty>
              )}
            </div>
          </Menu.SubContent>
        </Menu.Sub>
        {error && (
          <Menu.Label className="error-text" role="alert">
            {t("skillsLoadFailed")}
          </Menu.Label>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
