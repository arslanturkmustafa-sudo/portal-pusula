import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { UsersWorkspace } from "./users-workspace";

afterEach(() => vi.unstubAllGlobals());

it("saves removal of the last project as no access and disables global modules", async () => {
  const projectId = "10000000-0000-4000-8000-000000000001";
  const user = { id: "20000000-0000-4000-8000-000000000001", displayName: "Ekip Üyesi", email: "ekip@example.test", role: "member", status: "active", credentialVersion: 1, permissions: ["tasks.read"], projectIds: [projectId] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return Response.json({ user: { ...user, credentialVersion: 2, projectIds: [] } });
    return Response.json(url === "/api/projects" ? { projects: [{ id: projectId, displayName: "Alpha", shortCode: "ALPHA" }] } : { users: [user] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const interaction = userEvent.setup();
  render(<UsersWorkspace />);
  await interaction.click(await screen.findByText("Ekip Üyesi"));
  const save = await screen.findByRole("button", { name: "Yetkileri kaydet" });
  const editor = within(save.closest("form")!);
  expect(editor.getByLabelText("Finans raporlarını gör")).toBeDisabled();
  const project = editor.getByLabelText("Alpha · ALPHA");
  expect(project).toBeChecked();
  await interaction.click(project);
  await interaction.click(save);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/users/${user.id}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ permissions: ["tasks.read"], projectIds: [], status: "active" }) })));
  expect(await screen.findByText("Yetkiler kaydedildi; sonraki istekte geçerli.")).toBeInTheDocument();
});
