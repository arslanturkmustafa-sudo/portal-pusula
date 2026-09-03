import type { Metadata } from "next";

import { ProjectsWorkspace } from "@/components/home/projects-workspace";

export const metadata: Metadata = {
  title: "Projeler · Portal Pusula",
};

export default function ProjectsPage() {
  return <ProjectsWorkspace />;
}
