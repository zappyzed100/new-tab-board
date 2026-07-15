// PanelCard.tsx — サイドバーウィジェット共通の外枠(Card+見出し)。パネルごとに見出しサイズが
// バラバラだった(TodoList/TagCandidatesPanel=size4、SpecialPanel=size2)のを統一する。
import type { ReactNode } from "react";
import { Card, Flex, Heading } from "@radix-ui/themes";

type Props = {
  "data-testid": string;
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
};

export function PanelCard({ "data-testid": testId, title, icon, children }: Props) {
  return (
    <Card data-testid={testId} className="panel-card">
      {title && (
        <Heading as="h2" size="3" mb="2">
          <Flex align="center" gap="1" as="span">
            {icon}
            {title}
          </Flex>
        </Heading>
      )}
      {children}
    </Card>
  );
}
