import {
  GRAPH_LIMITS,
  findGraphNodeLocation,
  flattenGraphNodes,
  flattenSemanticNodes,
  isContainerNode,
  parseGraph,
  type SemanticNodeLocation,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

type VisualState = SemanticNode["states"][number]["name"];

export type EditorNodeLocation = SemanticNodeLocation;

export function locateEditorNode(
  graph: SemanticInterfaceGraph,
  nodeId: string,
): EditorNodeLocation | null {
  return findGraphNodeLocation(graph, nodeId) ?? null;
}

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

function requiresPosition(parent: SemanticNode | null): boolean {
  return parent?.kind === "freeform"
    || (parent?.kind === "adaptive" && (
      parent.layout.adaptive?.compact === "freeform"
      || parent.layout.adaptive?.regular === "freeform"
    ));
}

function operationRootIds(graph: SemanticInterfaceGraph, nodeIds: readonly string[]): string[] {
  const requested = new Set(nodeIds);
  return flattenGraphNodes(graph)
    .filter((node) => requested.has(node.id))
    .filter((node) => {
      let parent = findGraphNodeLocation(graph, node.id)?.parent ?? null;
      while (parent) {
        if (requested.has(parent.id)) return false;
        parent = findGraphNodeLocation(graph, parent.id)?.parent ?? null;
      }
      return true;
    })
    .map((node) => node.id);
}

function allocateDuplicateId(existingIds: Set<string>, baseId: string): string {
  for (let copyIndex = 1; copyIndex < 10_000; copyIndex += 1) {
    const suffix = copyIndex === 1 ? "-copy" : `-copy-${copyIndex}`;
    const candidate = `${baseId.slice(0, GRAPH_LIMITS.maxIdLength - suffix.length).replace(/[.-]+$/, "")}${suffix}`;
    if (!existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate duplicate node id for ${baseId}`);
}

function cloneSubtree(node: SemanticNode, existingIds: Set<string>, root: boolean): SemanticNode {
  const copy = structuredClone(node);
  copy.id = allocateDuplicateId(existingIds, node.id);
  if (root) {
    copy.intent.label = `${node.intent.label ?? node.intent.purpose} copy`;
    copy.accessibility.label = copy.intent.label;
  }
  copy.provenance = { author: "human", revision: 0 };
  copy.children = node.children.map((child) => cloneSubtree(child, existingIds, false));
  return copy;
}

export function reorderChildrenTransaction(
  graph: SemanticInterfaceGraph,
  screenId: string,
  parentId: string | null,
  orderedIds: string[],
): SemanticInterfaceGraph {
  return applyEditorTransaction(graph, (draft) => {
    const screen = draft.screens.find((item) => item.id === screenId);
    if (!screen) throw new Error(`Screen not found: ${screenId}`);
    const siblings = parentId === null
      ? screen.nodes
      : locateEditorNode(draft, parentId)?.node.children;
    if (!siblings) throw new Error(`Parent node not found: ${parentId}`);
    const existingIds = siblings.map((node) => node.id);
    if (orderedIds.length !== existingIds.length
      || new Set(orderedIds).size !== orderedIds.length
      || orderedIds.some((id) => !existingIds.includes(id))) {
      throw new Error("A child reorder must contain every existing sibling exactly once");
    }
    const byId = new Map(siblings.map((node) => [node.id, node]));
    siblings.splice(0, siblings.length, ...orderedIds.map((id) => byId.get(id)!));
  });
}

export function moveNodeTransaction(
  graph: SemanticInterfaceGraph,
  nodeId: string,
  targetParentId: string | null,
  targetIndex?: number,
): SemanticInterfaceGraph {
  return applyEditorTransaction(graph, (draft) => {
    const source = locateEditorNode(draft, nodeId);
    if (!source) throw new Error(`Node not found: ${nodeId}`);
    const targetParent = targetParentId ? locateEditorNode(draft, targetParentId) : null;
    if (targetParent && targetParent.screen.id !== source.screen.id) {
      throw new Error("Nodes cannot move across screens without an explicit cross-screen operation");
    }
    if (targetParent && !isContainerNode(targetParent.node)) {
      throw new Error(`Target parent is not a container: ${targetParentId}`);
    }
    if (targetParentId === nodeId
      || flattenSemanticNodes(source.node.children).some((node) => node.id === targetParentId)) {
      throw new Error("A node cannot move into itself or one of its descendants");
    }
    if (requiresPosition(targetParent?.node ?? null) && !source.node.layout.position) {
      throw new Error("Moving into freeform requires an explicit semantic position");
    }

    const targetSiblings = targetParent?.node.children ?? source.screen.nodes;
    const requestedIndex = targetIndex ?? targetSiblings.length;
    const sameSiblings = targetSiblings === source.siblings;
    source.siblings.splice(source.index, 1);
    const adjustedIndex = sameSiblings && requestedIndex > source.index ? requestedIndex - 1 : requestedIndex;
    const insertionIndex = Math.max(0, Math.min(targetSiblings.length, adjustedIndex));
    source.node.provenance = { author: "human", revision: source.node.provenance.revision + 1 };
    targetSiblings.splice(insertionIndex, 0, source.node);
  });
}

export function insertChildTransaction(
  graph: SemanticInterfaceGraph,
  screenId: string,
  parentId: string | null,
  node: SemanticNode,
  index?: number,
): SemanticInterfaceGraph {
  return applyEditorTransaction(graph, (draft) => {
    const screen = draft.screens.find((item) => item.id === screenId);
    if (!screen) throw new Error(`Screen not found: ${screenId}`);
    const parent = parentId ? locateEditorNode(draft, parentId) : null;
    if (parent && parent.screen.id !== screenId) throw new Error(`Parent is not on screen ${screenId}`);
    if (parent && !isContainerNode(parent.node)) throw new Error(`Target parent is not a container: ${parentId}`);
    if (requiresPosition(parent?.node ?? null) && !node.layout.position) {
      throw new Error("Inserting into freeform requires an explicit semantic position");
    }
    const siblings = parent?.node.children ?? screen.nodes;
    const insertionIndex = Math.max(0, Math.min(siblings.length, index ?? siblings.length));
    siblings.splice(insertionIndex, 0, structuredClone(node));
  });
}

export function wrapNodesTransaction(
  graph: SemanticInterfaceGraph,
  screenId: string,
  nodeIds: string[],
  container: SemanticNode,
): SemanticInterfaceGraph {
  return applyEditorTransaction(graph, (draft) => {
    if (!isContainerNode(container)) throw new Error("A wrapper must use a container kind");
    if (nodeIds.length === 0 || new Set(nodeIds).size !== nodeIds.length) {
      throw new Error("A wrapper needs at least one unique sibling node");
    }
    const locations = nodeIds.map((id) => locateEditorNode(draft, id));
    if (locations.some((location) => !location || location.screen.id !== screenId)) {
      throw new Error(`Every wrapped node must exist on screen ${screenId}`);
    }
    const concrete = locations as EditorNodeLocation[];
    const siblings = concrete[0]!.siblings;
    if (concrete.some((location) => location.siblings !== siblings)) {
      throw new Error("Only nodes with the same parent can be wrapped together");
    }
    const selected = new Set(nodeIds);
    const children = siblings.filter((node) => selected.has(node.id));
    const insertionIndex = Math.min(...concrete.map((location) => location.index));
    const wrapper = structuredClone(container);
    wrapper.children = children;
    siblings.splice(0, siblings.length, ...siblings.filter((node) => !selected.has(node.id)));
    siblings.splice(insertionIndex, 0, wrapper);
  });
}

export function removeNodeTransaction(
  graph: SemanticInterfaceGraph,
  nodeId: string,
): SemanticInterfaceGraph {
  return applyEditorTransaction(graph, (draft) => {
    const location = locateEditorNode(draft, nodeId);
    if (!location) throw new Error(`Node not found: ${nodeId}`);
    if (!location.parent && location.screen.nodes.length <= 1) {
      throw new Error("A screen must retain at least one root node");
    }
    location.siblings.splice(location.index, 1);
  });
}

export function removeNodesTransaction(
  graph: SemanticInterfaceGraph,
  nodeIds: readonly string[],
): SemanticInterfaceGraph {
  const roots = operationRootIds(graph, nodeIds);
  if (roots.length === 0) throw new Error("At least one existing node must be selected");
  return applyEditorTransaction(graph, (draft) => {
    const locations = roots.map((id) => locateEditorNode(draft, id));
    if (locations.some((location) => !location)) throw new Error("A selected node no longer exists");
    const bySiblings = new Map<SemanticNode[], EditorNodeLocation[]>();
    for (const location of locations as EditorNodeLocation[]) {
      const entries = bySiblings.get(location.siblings) ?? [];
      entries.push(location);
      bySiblings.set(location.siblings, entries);
    }
    for (const entries of bySiblings.values()) {
      for (const location of entries.sort((a, b) => b.index - a.index)) {
        location.siblings.splice(location.index, 1);
      }
    }
  });
}

export function updateNodeLayoutTransaction(
  graph: SemanticInterfaceGraph,
  nodeId: string,
  mutate: (layout: SemanticNode["layout"]) => void,
): SemanticInterfaceGraph {
  return applyEditorTransaction(graph, (draft) => {
    const location = locateEditorNode(draft, nodeId);
    if (!location) throw new Error(`Node not found: ${nodeId}`);
    mutate(location.node.layout);
    location.node.provenance = { author: "human", revision: location.node.provenance.revision + 1 };
  });
}

export function setFreeformPositionsTransaction(
  graph: SemanticInterfaceGraph,
  positions: Readonly<Record<string, { x: number; y: number }>>,
): SemanticInterfaceGraph {
  if (Object.keys(positions).length === 0) throw new Error("At least one freeform position is required");
  return applyEditorTransaction(graph, (draft) => {
    for (const [nodeId, position] of Object.entries(positions)) {
      const location = locateEditorNode(draft, nodeId);
      if (!location) throw new Error(`Node not found: ${nodeId}`);
      if (!requiresPosition(location.parent)) throw new Error(`Node is not in a freeform relation: ${nodeId}`);
      location.node.layout.position = {
        x: position.x,
        y: position.y,
        z: location.node.layout.position?.z ?? 0,
      };
      location.node.provenance = { author: "human", revision: location.node.provenance.revision + 1 };
    }
  });
}

export function duplicateNodeTransaction(
  graph: SemanticInterfaceGraph,
  nodeId: string,
): { graph: SemanticInterfaceGraph; nodeId: string } {
  const result = duplicateNodesTransaction(graph, [nodeId]);
  return { graph: result.graph, nodeId: result.nodeIds[0]! };
}

export function duplicateNodesTransaction(
  graph: SemanticInterfaceGraph,
  nodeIds: readonly string[],
): { graph: SemanticInterfaceGraph; nodeIds: string[] } {
  const roots = operationRootIds(graph, nodeIds);
  if (roots.length === 0) throw new Error("At least one existing node must be selected");
  const duplicatedIds: string[] = [];
  const nextGraph = applyEditorTransaction(graph, (draft) => {
    const existingIds = new Set(flattenGraphNodes(draft).map((node) => node.id));
    for (const nodeId of roots) {
      const source = locateEditorNode(draft, nodeId);
      if (!source) throw new Error(`Node not found: ${nodeId}`);
      const copy = cloneSubtree(source.node, existingIds, true);
      duplicatedIds.push(copy.id);
      source.siblings.splice(source.index + 1, 0, copy);
    }
  });
  return { graph: nextGraph, nodeIds: duplicatedIds };
}

export function moveSelectionTransaction(
  graph: SemanticInterfaceGraph,
  nodeIds: readonly string[],
  direction: -1 | 1,
): SemanticInterfaceGraph {
  const roots = operationRootIds(graph, nodeIds);
  if (roots.length === 0) throw new Error("At least one existing node must be selected");
  return applyEditorTransaction(graph, (draft) => {
    const locations = roots.map((id) => locateEditorNode(draft, id));
    if (locations.some((location) => !location)) throw new Error("A selected node no longer exists");
    const siblings = locations[0]!.siblings;
    if (locations.some((location) => location!.siblings !== siblings)) {
      throw new Error("A multi-layer reorder requires one shared parent");
    }
    const selected = new Set(roots);
    if (direction < 0) {
      for (let index = 1; index < siblings.length; index += 1) {
        if (selected.has(siblings[index]!.id) && !selected.has(siblings[index - 1]!.id)) {
          [siblings[index - 1], siblings[index]] = [siblings[index]!, siblings[index - 1]!];
        }
      }
    } else {
      for (let index = siblings.length - 2; index >= 0; index -= 1) {
        if (selected.has(siblings[index]!.id) && !selected.has(siblings[index + 1]!.id)) {
          [siblings[index], siblings[index + 1]] = [siblings[index + 1]!, siblings[index]!];
        }
      }
    }
    for (const node of siblings) {
      if (selected.has(node.id)) node.provenance = { author: "human", revision: node.provenance.revision + 1 };
    }
  });
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
  const existingNodeIds = new Set(flattenGraphNodes(graph).map((node) => node.id));
  let firstNodeId: string | null = null;

  const nextGraph = applyEditorTransaction(graph, (draft) => {
    const sourceIndex = draft.screens.findIndex((screen) => screen.id === screenId);
    const sourceScreen = draft.screens[sourceIndex];
    if (!sourceScreen) throw new Error(`Screen not found: ${screenId}`);

    const copy = structuredClone(sourceScreen);
    copy.id = targetScreenId;
    copy.title = `${sourceScreen.title} copy`;
    copy.route = `/${targetScreenId}`;
    let nodeIndex = 0;
    const remapNode = (node: SemanticNode): SemanticNode => {
      const remapped: SemanticNode = {
        ...node,
        id: copiedNodeId(existingNodeIds, screenId, targetScreenId, node.id, nodeIndex),
        provenance: { author: "human" as const, revision: 0 },
        children: [],
      };
      nodeIndex += 1;
      remapped.children = node.children.map(remapNode);
      return remapped;
    };
    copy.nodes = copy.nodes.map(remapNode);
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
