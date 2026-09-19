// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickStart } from "@/components/sentinel/quick-start";
import { exampleRequests } from "@/components/sentinel/request-composer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(disabled = false) {
  const onChooseMode = vi.fn();
  const onUseExample = vi.fn();
  const view = render(<QuickStart onChooseMode={onChooseMode} onUseExample={onUseExample} disabled={disabled} />);
  return { ...view, onChooseMode, onUseExample };
}

describe("Quick start", () => {
  it.each(["metaKey", "ctrlKey"])("opens with %s + K and focuses the search field", key => {
    setup();
    fireEvent.keyDown(document, { key: "k", [key]: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search modes and examples" }));
  });

  it("filters the list and fills one example without issuing a request", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { onChooseMode, onUseExample } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Quick start" }));
    const search = screen.getByRole("textbox", { name: "Search modes and examples" });
    fireEvent.change(search, { target: { value: "portable" } });
    expect(screen.queryByRole("button", { name: /find a replacement/i })).toBeNull();
    expect(screen.getByRole("button", { name: /portable monitor/i })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onUseExample).toHaveBeenCalledExactlyOnceWith(exampleRequests[0].prompt);
    expect(onChooseMode).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("chooses a mode and closes the palette", () => {
    const { onChooseMode, onUseExample } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Quick start" }));
    fireEvent.click(screen.getByRole("button", { name: /find a replacement/i }));
    expect(onChooseMode).toHaveBeenCalledExactlyOnceWith("inspect");
    expect(onUseExample).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a useful empty state without selecting anything on Enter", () => {
    const { onChooseMode, onUseExample } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Quick start" }));
    const search = screen.getByRole("textbox", { name: "Search modes and examples" });
    fireEvent.change(search, { target: { value: "zzznomatch" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toContain("No matches just yet");
    expect(onChooseMode).not.toHaveBeenCalled();
    expect(onUseExample).not.toHaveBeenCalled();
  });

  it("restores focus to the trigger when Escape dismisses it", async () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Quick start" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not open through the trigger or keyboard during a running task", () => {
    const { onChooseMode, onUseExample } = setup(true);
    const trigger = screen.getByRole("button", { name: "Quick start" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChooseMode).not.toHaveBeenCalled();
    expect(onUseExample).not.toHaveBeenCalled();
  });
});
