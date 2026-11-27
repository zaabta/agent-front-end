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

function inlineCitations(answer: string): AgentCitation[] {
  const seen = new Set<string>();
  return [...answer.matchAll(/\[\[([^\]\r\n]+)\]\]/g)].flatMap((match) => {
    const source = match[1]?.trim();
    if (!source || seen.has(source)) return [];
    const { fileName } = citationSource(source);
    if (!/\.(?:pdf|docx?|xlsx?|xls|csv|md|txt)$/i.test(fileName)) return [];
    seen.add(source);
    return [{ source }];
  });
}

export interface AgentCitation {
  source: string;
  citationId?: string;
  documentVersionId?: string;
  sourceRef?: string;
  chunkIndex?: number;
  pageNumber?: number;
  location?: string | null;
  headingPath?: string[];
  sheetName?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  rowNumbers?: number[];
  cellRange?: string | null;
  cellRefs?: string[];
  matchedCell?: string | null;
  section?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
}

export function AgentCitations({
  citations,
  answerText = "",
}: {
  citations: AgentCitation[];
  answerText?: string;
}) {
  const displayedCitations = citations.length
    ? citations
    : inlineCitations(answerText);
  if (!displayedCitations.length) return null;
  return (
    <div className="agent-citations" aria-label="Answer sources">
      {displayedCitations.map((citation, index) => {
        const { fileName, embeddedLocation } = citationSource(citation.source);
        const spreadsheetLocation = citation.sheetName
          ? [
              `Sheet ${citation.sheetName}`,
              citation.rowNumbers?.length
                ? `Rows ${citation.rowNumbers.join(", ")}`
                : citation.rowStart != null
                  ? `Rows ${citation.rowStart}${citation.rowEnd && citation.rowEnd !== citation.rowStart ? `–${citation.rowEnd}` : ""}`
                  : "",
              citation.cellRange
                ? `Cells ${citation.cellRange}`
                : citation.cellRefs?.length
                  ? `Cells ${citation.cellRefs.join(", ")}`
                  : citation.matchedCell
                    ? `Cell ${citation.matchedCell}`
                    : "",
            ].filter(Boolean).join(" · ")
          : null;
        const location =
          citation.location ??
          spreadsheetLocation ??
          (citation.headingPath?.length ? citation.headingPath.join(" › ") : null) ??
          (citation.pageNumber != null ? `Page ${citation.pageNumber}` : null) ??
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
            id={citation.citationId ? `citation-${citation.citationId}` : undefined}
            tabIndex={citation.citationId ? -1 : undefined}
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
