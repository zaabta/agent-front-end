import { Streamdown } from "streamdown";

export function readableAgentText(text: string) {
  return text
    .replace(/^[ \t]*Sources:[ \t]*(?:\[\[[^\]\r\n]+\]\][ \t]*)+[ \t]*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function AgentAnswer({
  content,
  isAnimating = false,
}: {
  content: string;
  isAnimating?: boolean;
}) {
  return (
    <Streamdown
      className="agent-answer-content"
      dir="auto"
      mode={isAnimating ? "streaming" : "static"}
      isAnimating={isAnimating}
      controls={false}
      lineNumbers={false}
      codeBlockMaxHeight={0}
    >
      {readableAgentText(content)}
    </Streamdown>
  );
}
