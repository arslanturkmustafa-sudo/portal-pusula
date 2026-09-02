import type { Metadata } from "next";

import { TasksWorkspace } from "@/components/home/tasks-workspace";

export const metadata: Metadata = {
  title: "Görevler · Portal Pusula",
};

export default function TasksPage() {
  return <TasksWorkspace />;
}
