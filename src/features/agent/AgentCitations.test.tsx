import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AgentCitations } from "./AgentCitations";

describe("agent citation rendering", () => {
  it("shows only returned Markdown and Word source metadata", () => {
    render(
      <AgentCitations
        citations={[
          {
            source: "guide.md",
            sourceRef: "ref-md",
            chunkIndex: 0,
            location: "Heading: Setup",
          },
          {
            source: "report.docx",
            citationId: "C2",
            sourceRef: "ref-docx",
            documentVersionId: "version-4",
            chunkIndex: 3,
            paragraphStart: 7,
            paragraphEnd: 8,
          },
        ]}
      />,
    );
    expect(screen.getByText("guide.md")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "MD file" })).toBeInTheDocument();
    expect(
      screen.getByText("Passage 1 · Heading: Setup · ref-md"),
    ).toBeInTheDocument();
    expect(screen.getByText("report.docx").closest("#citation-C2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "DOCX file" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Passage 4 · Paragraph 7–8 · Version version-4 · ref-docx",
      ),
    ).toBeInTheDocument();
  });

  it("shows exact spreadsheet sheet, row, and cell metadata", () => {
    render(
      <AgentCitations
        citations={[
          {
            source: "costs.xlsx",
            citationId: "C1",
            sheetName: "Costs",
            rowStart: 4,
            rowEnd: 5,
            cellRange: "A4:B5",
          },
        ]}
      />,
    );
    expect(screen.getByText("Sheet Costs · Rows 4–5 · Cells A4:B5")).toBeInTheDocument();
  });
  it("renders no citation panel when the backend provides no sources", () => {
    const { container } = render(<AgentCitations citations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("separates the filename from an inline section and paragraph citation", () => {
    render(
      <AgentCitations
        citations={[
          {
            source:
              "_نظام_إدارة_متكامل_لمصنع_البلاستيك_نسخة_متطلبات_كاملة.docx (section 25. الأجهزة والطابعات, paragraphs 297-298)",
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "_نظام_إدارة_متكامل_لمصنع_البلاستيك_نسخة_متطلبات_كاملة.docx",
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen
          .getByText(
            "_نظام_إدارة_متكامل_لمصنع_البلاستيك_نسخة_متطلبات_كاملة.docx",
          )
          .closest(".citation")!,
      ).getByRole("img", { name: "DOCX file" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Section 25. الأجهزة والطابعات · Paragraphs 297-298",
      ),
    ).toBeInTheDocument();
  });

  it("shows a PDF icon and page number from an inline source", () => {
    render(
      <AgentCitations
        citations={[{ source: "concrete-structure1.pdf (page 1)" }]}
      />,
    );
    expect(screen.getByText("concrete-structure1.pdf")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "PDF file" })).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("renders inline source markers as deduplicated file cards", () => {
    const { container } = render(
      <AgentCitations
        citations={[]}
        answerText={
          "Sources: [[09-faq-and-response-guardrails.md (section Web Search)]] [[09-faq-and-response-guardrails.md (section Web Search)]] [[04-companies-and-branches.md (section Companies and Branches)]] [[_نظام_إدارة_متكامل_لمصنع_البلاستيك_نسخة_متطلبات_كاملة.docx (section 18. الإشعارات, paragraphs 280-282)]]"
        }
      />,
    );
    expect(
      within(container).getByText("09-faq-and-response-guardrails.md"),
    ).toBeInTheDocument();
    expect(
      within(container).getAllByRole("img", { name: "MD file" }),
    ).toHaveLength(2);
    expect(container.querySelectorAll(".citation")).toHaveLength(3);
    expect(
      within(container).getByText("04-companies-and-branches.md"),
    ).toBeInTheDocument();
    expect(
      within(container).getByText(
        "_نظام_إدارة_متكامل_لمصنع_البلاستيك_نسخة_متطلبات_كاملة.docx",
      ),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("img", { name: "DOCX file" }),
    ).toBeInTheDocument();
    expect(
      within(container).getByText(
        "Section 18. الإشعارات · Paragraphs 280-282",
      ),
    )
      .toBeInTheDocument();
  });
});
