import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { TaskGroups } from "./task-groups";

it("keeps imported tasks folded, opens their program, and reveals filtered matches", async () => {
  const source = { id: "snapshot-1", analysisId: "14", companyName: "Deneme Firma", programCode: "PRG-YON-01" };
  const tasks = [
    { id: "1", description: "PRG-YON-01 — Strateji programı", bypusula: source },
    { id: "2", description: "Elle düzenlenmiş açıklama", bypusula: source },
    { id: "3", description: null },
  ];
  const props = { tasks, renderTask: (task: { id: string }) => <article>Görev {task.id}</article> };
  const { rerender } = render(<TaskGroups {...props} expandMatches={false} />);
  expect(screen.getByText("Görev 1")).not.toBeVisible();
  expect(screen.getByText("Görev 3")).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByText("Deneme Firma"));
  expect(screen.getByText("Görev 1")).not.toBeVisible();
  await user.click(screen.getByText("Strateji programı"));
  expect(screen.getByText("Görev 1")).toBeVisible();
  expect(screen.getByText("Görev 2")).toBeVisible();
  await user.click(screen.getByText("Deneme Firma"));
  rerender(<TaskGroups {...props} expandMatches />);
  expect(screen.getByText("Görev 2")).toBeVisible();
});
