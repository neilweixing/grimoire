import { useState, type ReactElement, type ReactNode } from "react";
import * as Primitive from "@radix-ui/react-tooltip";

export function Tooltip({
  children,
  content,
}: {
  children: ReactElement;
  content: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <Primitive.Provider delayDuration={250}>
      <Primitive.Root>
        <Primitive.Trigger asChild ref={setAnchor}>
          {children}
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            className="composer-tooltip"
            side="top"
            sideOffset={8}
            collisionPadding={12}
            collisionBoundary={
              anchor?.closest<HTMLElement>(".thread") ?? undefined
            }
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            {content}
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
