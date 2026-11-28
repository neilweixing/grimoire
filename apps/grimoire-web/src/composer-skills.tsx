import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useWorkspace, workspaceApi } from "./workspace";
import type { SkillChoice } from "./skill-completion";

type SkillsState = {
  skills: SkillChoice[];
  pending: boolean;
  error: boolean;
  reload: () => Promise<void>;
};
const SkillsContext = createContext<SkillsState | null>(null);
export function ComposerSkillsProvider({ children }: PropsWithChildren) {
  const workspace = useWorkspace();
  const [skills, setSkills] = useState<SkillChoice[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSkills([]);
    setPending(true);
    setError(false);
    try {
      const available = await workspaceApi<SkillChoice[]>(
        workspace.id,
        "/pi/skills",
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setSkills(available.filter((skill) => skill.enabled));
    } catch {
      if (!controller.signal.aborted) {
        setSkills([]);
        setError(true);
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }, [workspace.id]);
  useEffect(() => {
    setSkills([]);
    void reload();
    return () => request.current?.abort();
  }, [reload]);
  return (
    <SkillsContext.Provider value={{ skills, pending, error, reload }}>
      {children}
    </SkillsContext.Provider>
  );
}
export function useComposerSkills() {
  const context = useContext(SkillsContext);
  if (!context) throw new Error("ComposerSkillsProvider is required.");
  return context;
}
