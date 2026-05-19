import {
  ontology,
  workflows as workflowsApi,
  type EventTypeRow,
} from "@/lib/api-client";
import { WorkflowsView } from "./_components/WorkflowsView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WorkflowsPage() {
  const [dag, eventTypesList] = await Promise.all([
    workflowsApi.dag(),
    ontology.eventTypes().catch(() => [] as EventTypeRow[]),
  ]);

  return (
    <WorkflowsView
      agents={dag.agents}
      edges={dag.edges}
      workflowVersion={dag.workflowVersion}
      eventTypes={eventTypesList.map((e) => ({
        name: e.name,
        category: e.category,
        color: e.color,
      }))}
    />
  );
}
