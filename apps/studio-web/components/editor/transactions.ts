import {
  parseGraph,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

type VisualState = SemanticNode["states"][number]["name"];

export function applyEditorTransaction(
  graph: SemanticInterfaceGraph,
  mutate: (draft: SemanticInterfaceGraph) => void,
): SemanticInterfaceGraph {
  const draft = structuredClone(graph);
  mutate(draft);
  return parseGraph(draft);
}

export function insertionStateBindings(state: VisualState): SemanticNode["states"] {
  return state === "idle" ? [] : [{ name: state }];
}

export function editorTransactionError(error: unknown): string {
  const issues = error && typeof error === "object" && "issues" in error
    ? (error as { issues?: Array<{ message?: unknown }> }).issues
    : undefined;
  const issueMessage = issues?.find((issue) => typeof issue.message === "string")?.message;
  const raw = typeof issueMessage === "string"
    ? issueMessage
    : error instanceof Error
      ? error.message
      : "The semantic transaction was invalid";
  const concise = raw.replace(/\s+/g, " ").trim().slice(0, 240).replace(/[.!?]+$/, "")
    || "The semantic transaction was invalid";
  return `Edit rejected: ${concise}. No changes were saved.`;
}

function copiedScreenId(graph: SemanticInterfaceGraph, screenId: string): string {
  const usedScreenIds = new Set(graph.screens.map((screen) => screen.id));
  const usedRoutes = new Set(graph.screens.map((screen) => screen.route));
  const usedFixtureIds = new Set(graph.fixtures.map((fixture) => fixture.id));
  const sourceFixtures = graph.fixtures.filter((fixture) => fixture.screenId === screenId);

  for (let copyIndex = 1; copyIndex < 10_000; copyIndex += 1) {
    const suffix = copyIndex === 1 ? "-copy" : `-copy-${copyIndex}`;
    const candidate = `${screenId.slice(0, 64 - suffix.length)}${suffix}`;
    const fixtureCollision = sourceFixtures.some((fixture) =>
      usedFixtureIds.has(`${candidate}.${fixture.state}`),
    );
    if (!usedScreenIds.has(candidate) && !usedRoutes.has(`/${candidate}`) && !fixtureCollision) {
      return candidate;
    }
  }
  throw new Error(`Could not allocate a duplicate id for screen ${screenId}`);
}

function copiedNodeId(
  existingIds: Set<string>,
  sourceScreenId: string,
  targetScreenId: string,
  sourceNodeId: string,
  nodeIndex: number,
): string {
  const sourceSuffix = sourceNodeId.startsWith(`${sourceScreenId}.`)
    ? sourceNodeId.slice(sourceScreenId.length + 1)
    : sourceNodeId;
  const fallback = `node-${nodeIndex + 1}`;
  const available = 96 - targetScreenId.length - 1;
  const base = sourceSuffix.slice(0, available).replace(/[.-]+$/, "") || fallback;

  for (let copyIndex = 1; copyIndex < 10_000; copyIndex += 1) {
    const suffix = copyIndex === 1 ? "" : `-${copyIndex}`;
    const local = `${base.slice(0, available - suffix.length).replace(/[.-]+$/, "")}${suffix}`;
    const candidate = `${targetScreenId}.${local}`;
    if (!existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate duplicate node id for ${sourceNodeId}`);
}

export function duplicateScreenTransaction(
  graph: SemanticInterfaceGraph,
  screenId: string,
): { graph: SemanticInterfaceGraph; screenId: string; nodeId: string | null } {
  const source = graph.screens.find((screen) => screen.id === screenId);
  if (!source) throw new Error(`Screen not found: ${screenId}`);
  const targetScreenId = copiedScreenId(graph, screenId);
  const existingNodeIds = new Set(graph.screens.flatMap((screen) => screen.nodes.map((node) => node.id)));
  let firstNodeId: string | null = null;

  const nextGraph = applyEditorTransaction(graph, (draft) => {
    const sourceIndex = draft.screens.findIndex((screen) => screen.id === screenId);
    const sourceScreen = draft.screens[sourceIndex];
    if (!sourceScreen) throw new Error(`Screen not found: ${screenId}`);

    const copy = structuredClone(sourceScreen);
    copy.id = targetScreenId;
    copy.title = `${sourceScreen.title} copy`;
    copy.route = `/${targetScreenId}`;
    copy.nodes = copy.nodes.map((node, nodeIndex) => ({
      ...node,
      id: copiedNodeId(existingNodeIds, screenId, targetScreenId, node.id, nodeIndex),
      provenance: { author: "human" as const, revision: 0 },
    }));
    firstNodeId = copy.nodes[0]?.id ?? null;
    draft.screens.splice(sourceIndex + 1, 0, copy);

    const fixtureIdMap = new Map<string, string>();
    for (const fixture of draft.fixtures.filter((item) => item.screenId === screenId)) {
      const fixtureCopy = structuredClone(fixture);
      fixtureCopy.id = `${targetScreenId}.${fixture.state}`;
      fixtureCopy.screenId = targetScreenId;
      fixtureIdMap.set(fixture.id, fixtureCopy.id);
      draft.fixtures.push(fixtureCopy);
    }

    const contract = draft.contracts.find((item) => item.screenId === screenId);
    if (contract) {
      const contractCopy = structuredClone(contract);
      contractCopy.screenId = targetScreenId;
      contractCopy.fixtures = contract.fixtures.map((fixtureId) => {
        const copiedFixtureId = fixtureIdMap.get(fixtureId);
        if (!copiedFixtureId) throw new Error(`Contract fixture not found while duplicating ${fixtureId}`);
        return copiedFixtureId;
      });
      draft.contracts.push(contractCopy);
    }
  });

  return { graph: nextGraph, screenId: targetScreenId, nodeId: firstNodeId };
}
