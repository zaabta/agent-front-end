import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentAnswer, readableAgentText } from "./AgentAnswer";

describe("Agent answer Markdown and direction", () => {
  it("renders bold Markdown and keeps Arabic paragraphs auto-directed", () => {
    const { container } = render(<AgentAnswer content={"مرحبا **بك**"} />);
    expect(screen.getByText("بك")).toHaveAttribute(
      "data-streamdown",
      "strong",
    );
    expect(
      container.querySelector('.agent-answer-content [dir="rtl"]'),
    ).toBeInTheDocument();
  });

  it("renders fenced code as left-to-right and Markdown tables as semantic tables", () => {
    const { container } = render(
      <AgentAnswer
        content={
          "| Name | Value |\n| --- | --- |\n| Total | 42 |\n\n```ts\nconst value = 42\n```"
        }
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(
      container.querySelector('[data-streamdown="code-block"][dir="ltr"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("const value = 42")).toBeInTheDocument();
  });

  it("hides structured Sources lines so citations can render as file cards", () => {
    const answer =
      "The total number of records is 25.\n\nSources: [[concrete-structure1.pdf (page 1)]]";
    render(<AgentAnswer content={answer} />);
    expect(
      screen.getByText("The total number of records is 25."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sources:/)).not.toBeInTheDocument();
    expect(readableAgentText(answer)).toBe(
      "The total number of records is 25.",
    );
  });
});
