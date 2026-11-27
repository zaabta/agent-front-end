import { Streamdown } from "streamdown";
import { AgentCitations, type AgentCitation } from "./AgentCitations";

type EvidenceReference = { claimIndex: number; citationIds: string[] };

function inlineCitations(text: string): AgentCitation[] {
  const sources = [...text.matchAll(/\[\[([^\]\r\n]+)\]\]/g)].map(
    (match) => match[1]!.trim(),
  );
  return [...new Set(sources)].map((source) => ({ source }));
}

export function readableAgentText(text: string) {
  return text
    .replace(/^[ \t]*Sources:[ \t]*(?:\[\[[^\]\r\n]+\]\][ \t]*)+[ \t]*$/gim, "")
    .replace(
      /\[\[(?=[^\]\r\n]*\.(?:pdf|docx?|xlsx?|xls|csv|md|txt)(?:\s|\]))[^\]\r\n]+\]\]/gi,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function AgentAnswer({
  content,
  isAnimating = false,
  citations = [],
  evidenceReferences = [],
}: {
  content: string;
  isAnimating?: boolean;
  citations?: AgentCitation[];
  evidenceReferences?: EvidenceReference[];
}) {
  const inline = inlineCitations(content).filter(
    ({ source }) =>
      !citations.some(
        (citation) =>
          citation.source.trim().toLocaleLowerCase() ===
          source.toLocaleLowerCase(),
      ),
  );
  const answerText = readableAgentText(content);
  const complexMarkdown = /(^|\n)\s*\|.*\n\s*\|[-: |]+\|/m.test(answerText) || answerText.includes("```");
  const citationLinks = (reference: EvidenceReference | undefined) =>
    reference?.citationIds.length ? (
      <span className="agent-inline-citations" aria-label={`Sources for claim ${reference.claimIndex + 1}`}>
        {reference.citationIds.map((id, index) => (
          <a href={`#citation-${id}`} key={id} aria-label={`Open source ${index + 1}`} title={id}>
            [{index + 1}]
          </a>
        ))}
      </span>
    ) : null;
  const streamdown = (text: string, key?: string) => (
    <Streamdown
      key={key}
      className="agent-answer-content"
      dir="auto"
      mode={isAnimating ? "streaming" : "static"}
      isAnimating={isAnimating}
      controls={false}
      lineNumbers={false}
      codeBlockMaxHeight={0}
    >
      {text}
    </Streamdown>
  );
  return (
    <>
      {isAnimating || complexMarkdown
        ? streamdown(answerText)
        : answerText.split(/\n{2,}/).map((claim, claimIndex) => (
            <div className="agent-answer-claim" key={claimIndex}>
              {streamdown(claim, `claim-${claimIndex}`)}
              {citationLinks(evidenceReferences.find((reference) => reference.claimIndex === claimIndex))}
            </div>
          ))}
      {(isAnimating || complexMarkdown) && evidenceReferences.map((reference) => (
        <div className="agent-answer-claim-citations" key={reference.claimIndex}>
          <small>Claim {reference.claimIndex + 1}</small>
          {citationLinks(reference)}
        </div>
      ))}
      <AgentCitations citations={inline} />
    </>
  );
}
