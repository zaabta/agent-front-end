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
    expect(screen.getByText("report.docx")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "DOCX file" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Passage 4 · Paragraph 7–8 · Version version-4 · ref-docx",
      ),
    ).toBeInTheDocument();
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
});
