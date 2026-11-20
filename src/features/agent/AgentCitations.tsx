import { DocumentFormatIcon } from "../documents/DocumentFormatIcon";

function citationSource(source: string) {
  const match = source.match(
    /^(.*?)\s+\(((?:section|sections|page|pages|line|lines|paragraph|paragraphs)\b.*?)\)$/i,
  );
  const fileName = match?.[1]?.trim() || source;
  const embeddedLocation = match?.[2]
    ?.replace(
      /^(section|sections|page|pages|line|lines|paragraph|paragraphs)\b/i,
      (label) => label[0]!.toUpperCase() + label.slice(1),
    )
    .replace(/,\s*(paragraphs?)\b/i, (_, label: string) =>
      ` · ${label[0]!.toUpperCase() + label.slice(1)}`,
    );
  return { fileName, embeddedLocation };
}

export interface AgentCitation {
  source: string;
  documentVersionId?: string;
  sourceRef?: string;
  chunkIndex?: number;
  location?: string | null;
  section?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
}

export function AgentCitations({ citations }: { citations: AgentCitation[] }) {
  if (!citations.length) return null;
  return (
    <div className="agent-citations" aria-label="Answer sources">
      {citations.map((citation, index) => {
        const { fileName, embeddedLocation } = citationSource(citation.source);
        const location =
          citation.location ??
          citation.section ??
          (citation.lineStart != null
            ? `Line ${citation.lineStart}${citation.lineEnd && citation.lineEnd !== citation.lineStart ? `–${citation.lineEnd}` : ""}`
            : citation.paragraphStart != null
              ? `Paragraph ${citation.paragraphStart}${citation.paragraphEnd && citation.paragraphEnd !== citation.paragraphStart ? `–${citation.paragraphEnd}` : ""}`
              : embeddedLocation ?? null);
        const details = [
          citation.chunkIndex != null
            ? `Passage ${citation.chunkIndex + 1}`
            : "",
          location ?? "",
          citation.documentVersionId
            ? `Version ${citation.documentVersionId}`
            : "",
          citation.sourceRef ?? "",
        ].filter(Boolean);
        return (
          <div
            className="citation"
            key={`${citation.sourceRef ?? citation.source}-${index}`}
          >
            <DocumentFormatIcon
              fileName={fileName}
              className="citation-file-icon"
            />
            <span className="citation-details">
              <b title={fileName}>{fileName}</b>
              {details.length > 0 && <small>{details.join(" · ")}</small>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
