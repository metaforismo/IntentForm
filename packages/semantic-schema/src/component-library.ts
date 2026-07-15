import type {
  ComponentDefinition,
  ComponentInstance,
  ComponentOverride,
  SemanticInterfaceGraph,
  SemanticNode,
} from "./index.ts";

type ComponentValue = string | number | boolean;

export const COMPONENT_LIBRARY_ABI_VERSION = "1.0.0" as const;

export interface LocalComponentLibrary {
  abiVersion: typeof COMPONENT_LIBRARY_ABI_VERSION;
  id: string;
  name: string;
  version: string;
  definitions: ComponentDefinition[];
}

export interface InstantiateComponentInput {
  definitionId: string;
  instanceId: string;
  screenId: string;
  parentId?: string | null;
  index?: number;
  variant?: string;
  state?: string;
  props?: Record<string, ComponentValue>;
  slots?: Record<string, SemanticNode[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function walkNodes(nodes: SemanticNode[], visit: (node: SemanticNode, siblings: SemanticNode[], index: number) => void): void {
  for (const [index, node] of nodes.entries()) {
    visit(node, nodes, index);
    walkNodes(node.children, visit);
  }
}

function walkAuthoredNodes(nodes: SemanticNode[], visit: (node: SemanticNode) => void): void {
  for (const node of nodes) {
    visit(node);
    walkAuthoredNodes(node.children, visit);
    for (const slotChildren of Object.values(node.componentInstance?.slots ?? {})) {
      walkAuthoredNodes(slotChildren, visit);
    }
  }
}

function findNode(nodes: SemanticNode[], id: string): SemanticNode | undefined {
  let match: SemanticNode | undefined;
  walkNodes(nodes, (node) => {
    if (!match && node.id === id) match = node;
  });
  return match;
}

function removeNode(nodes: SemanticNode[], id: string): boolean {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      nodes.splice(index, 1);
      return true;
    }
    if (removeNode(node.children, id)) return true;
  }
  return false;
}

function applyOverride(root: SemanticNode, override: ComponentOverride): void {
  if (override.op === "set-included") {
    if (override.target === root.id && !override.value) {
      throw new Error("A component override cannot remove the template root");
    }
    if (!override.value && !removeNode(root.children, override.target)) {
      throw new Error(`Component override target is unavailable: ${override.target}`);
    }
    return;
  }
  const target = findNode([root], override.target);
  if (!target) throw new Error(`Component override target is unavailable: ${override.target}`);
  if (override.op === "set-label") {
    target.intent.label = override.value;
    target.accessibility.label = override.value;
  }
  else if (override.op === "set-purpose") target.intent.purpose = override.value;
  else if (override.op === "set-importance") target.intent.importance = override.value;
  else if (override.op === "set-emphasis") target.style.emphasis = override.value;
  else if (override.op === "set-gap-token") target.layout.gapToken = override.value;
  else if (override.op === "set-padding-token") target.layout.paddingToken = override.value;
}

function resolvedProps(definition: ComponentDefinition, instance: ComponentInstance): Record<string, ComponentValue> {
  return Object.fromEntries(definition.properties.flatMap((property) => {
    const value = instance.props[property.name] ?? property.default;
    return value === undefined ? [] : [[property.name, value as ComponentValue]];
  }));
}

function applyPropertyBindings(
  root: SemanticNode,
  definition: ComponentDefinition,
  instance: ComponentInstance,
): void {
  const values = resolvedProps(definition, instance);
  for (const property of definition.properties) {
    const value = values[property.name];
    if (value === undefined) continue;
    for (const binding of property.bindings) {
      if (binding.field === "visible") {
        if (value === false) {
          if (binding.target === root.id) throw new Error("A component property cannot hide the template root");
          removeNode(root.children, binding.target);
        }
        continue;
      }
      const target = findNode([root], binding.target);
      if (!target) continue;
      if (binding.field === "intent.label") target.intent.label = String(value);
      else if (binding.field === "intent.purpose") target.intent.purpose = String(value);
      else if (binding.field === "accessibility.label") target.accessibility.label = String(value);
      else if (binding.field === "accessibility.hint") target.accessibility.hint = String(value);
      else if (binding.field === "layout.fixedWidth") {
        target.layout.width = "fixed";
        target.layout.fixedWidth = Number(value);
      } else if (binding.field === "layout.fixedHeight") {
        target.layout.height = "fixed";
        target.layout.fixedHeight = Number(value);
      }
    }
  }
}

function remapTemplateIds(root: SemanticNode, instanceId: string): Map<string, string> {
  const rootLocalId = root.id;
  const idMap = new Map<string, string>();
  walkNodes([root], (node) => {
    const nextId = node.id === rootLocalId ? instanceId : `${instanceId}.${node.id}`;
    if (nextId.length > 96) throw new Error(`Expanded component node id exceeds 96 characters: ${nextId}`);
    idMap.set(node.id, nextId);
  });
  walkNodes([root], (node) => {
    node.id = idMap.get(node.id)!;
  });
  return idMap;
}

function materializeNode(
  node: SemanticNode,
  definitions: Map<string, ComponentDefinition>,
  stack: readonly string[],
  instanceDepth = 0,
): SemanticNode {
  if (!node.componentInstance) {
    const copy = clone(node);
    copy.children = copy.children.map((child) => materializeNode(child, definitions, stack, instanceDepth));
    return copy;
  }

  const instance = clone(node.componentInstance);
  const definition = definitions.get(instance.definitionId);
  if (!definition) throw new Error(`Unknown component definition: ${instance.definitionId}`);
  if (stack.includes(definition.id)) {
    throw new Error(`Component dependency cycle: ${[...stack, definition.id].join(" -> ")}`);
  }
  if (instanceDepth >= 16) throw new Error("Component instance nesting exceeds 16 levels");

  const root = clone(definition.template);
  applyPropertyBindings(root, definition, instance);
  const variantId = instance.variant ?? definition.defaultVariant;
  const stateId = instance.state ?? definition.defaultState;
  const variant = variantId ? definition.variants.find((candidate) => candidate.id === variantId) : undefined;
  const state = stateId ? definition.states.find((candidate) => candidate.id === stateId) : undefined;
  for (const override of variant?.overrides ?? []) applyOverride(root, override);
  for (const override of state?.overrides ?? []) applyOverride(root, override);
  for (const override of instance.overrides) applyOverride(root, override);

  root.children = root.children.map((child) =>
    materializeNode(child, definitions, [...stack, definition.id], instanceDepth + 1));
  remapTemplateIds(root, node.id);

  for (const slot of definition.slots) {
    if (!Object.hasOwn(instance.slots, slot.name)) continue;
    const targetId = slot.target === definition.template.id ? node.id : `${node.id}.${slot.target}`;
    const target = findNode([root], targetId);
    if (!target) throw new Error(`Component slot target is unavailable: ${definition.id}.${slot.name}`);
    target.children = instance.slots[slot.name]!.map((child) =>
      materializeNode(child, definitions, stack, instanceDepth + 1));
  }

  root.id = node.id;
  const instanceLayout = clone(node.layout);
  root.layout = {
    ...root.layout,
    width: instanceLayout.width,
    height: instanceLayout.height,
    ...(instanceLayout.fixedWidth === undefined ? {} : { fixedWidth: instanceLayout.fixedWidth }),
    ...(instanceLayout.fixedHeight === undefined ? {} : { fixedHeight: instanceLayout.fixedHeight }),
    ...(instanceLayout.minWidth === undefined ? {} : { minWidth: instanceLayout.minWidth }),
    ...(instanceLayout.maxWidth === undefined ? {} : { maxWidth: instanceLayout.maxWidth }),
    ...(instanceLayout.minHeight === undefined ? {} : { minHeight: instanceLayout.minHeight }),
    ...(instanceLayout.maxHeight === undefined ? {} : { maxHeight: instanceLayout.maxHeight }),
    ...(instanceLayout.position === undefined ? {} : { position: instanceLayout.position }),
    ...(instanceLayout.placement === undefined ? {} : { placement: instanceLayout.placement }),
  };
  for (const optional of [
    "fixedWidth", "fixedHeight", "minWidth", "maxWidth", "minHeight", "maxHeight", "position", "placement",
  ] as const) {
    if (instanceLayout[optional] === undefined) delete root.layout[optional];
  }
  root.provenance = clone(node.provenance);
  root.componentInstance = instance;
  return root;
}

export function synchronizeComponentInstances<T extends SemanticInterfaceGraph>(graph: T): T {
  if (!graph.screens.some((screen) => screen.nodes.some((node) => {
    let found = false;
    walkNodes([node], (candidate) => { if (candidate.componentInstance) found = true; });
    return found;
  }))) return graph;
  const cloneGraph = clone(graph);
  const definitions = new Map(cloneGraph.components.map((definition) => [definition.id, definition]));
  cloneGraph.screens.forEach((screen) => {
    screen.nodes = screen.nodes.map((node) => materializeNode(node, definitions, []));
  });
  return cloneGraph;
}

function mutateInstance<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
  mutate: (instance: ComponentInstance, definition: ComponentDefinition) => void,
): T {
  const next = clone(graph);
  const definitions = new Map(next.components.map((definition) => [definition.id, definition]));
  let target: SemanticNode | undefined;
  for (const screen of next.screens) target ??= findNode(screen.nodes, instanceId);
  if (!target?.componentInstance) throw new Error(`Unknown component instance: ${instanceId}`);
  const definition = definitions.get(target.componentInstance.definitionId);
  if (!definition) throw new Error(`Unknown component definition: ${target.componentInstance.definitionId}`);
  mutate(target.componentInstance, definition);
  return synchronizeComponentInstances(next);
}

export function instantiateComponent<T extends SemanticInterfaceGraph>(
  graph: T,
  input: InstantiateComponentInput,
): T {
  const next = clone(graph);
  const definition = next.components.find((candidate) => candidate.id === input.definitionId);
  if (!definition) throw new Error(`Unknown component definition: ${input.definitionId}`);
  if (definition.deprecated) throw new Error(`Component ${definition.id} is deprecated: ${definition.deprecated.message}`);
  if (next.screens.some((screen) => {
    let collision = false;
    walkNodes(screen.nodes, (node) => { if (node.id === input.instanceId) collision = true; });
    return collision;
  })) throw new Error(`Component instance id is already in use: ${input.instanceId}`);
  const screen = next.screens.find((candidate) => candidate.id === input.screenId);
  if (!screen) throw new Error(`Unknown screen: ${input.screenId}`);

  const placeholder = clone(definition.template);
  placeholder.id = input.instanceId;
  placeholder.children = [];
  placeholder.componentInstance = {
    definitionId: definition.id,
    ...(input.variant ? { variant: input.variant } : {}),
    ...(input.state ? { state: input.state } : {}),
    props: clone(input.props ?? {}),
    slots: clone(input.slots ?? {}),
    overrides: [],
  };
  const siblings = input.parentId
    ? findNode(screen.nodes, input.parentId)?.children
    : screen.nodes;
  if (!siblings) throw new Error(`Unknown component parent: ${input.parentId}`);
  const index = Math.min(input.index ?? siblings.length, siblings.length);
  siblings.splice(index, 0, placeholder);
  return synchronizeComponentInstances(next);
}

export function setComponentVariant<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
  variant: string | null,
): T {
  return mutateInstance(graph, instanceId, (instance, definition) => {
    if (variant && !definition.variants.some((candidate) => candidate.id === variant)) {
      throw new Error(`Unknown component variant: ${definition.id}.${variant}`);
    }
    if (variant) instance.variant = variant;
    else delete instance.variant;
  });
}

export function setComponentState<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
  state: string | null,
): T {
  return mutateInstance(graph, instanceId, (instance, definition) => {
    if (state && !definition.states.some((candidate) => candidate.id === state)) {
      throw new Error(`Unknown component state: ${definition.id}.${state}`);
    }
    if (state) instance.state = state;
    else delete instance.state;
  });
}

export function setComponentProperty<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
  propertyName: string,
  value: ComponentValue,
): T {
  return mutateInstance(graph, instanceId, (instance, definition) => {
    const property = definition.properties.find((candidate) => candidate.name === propertyName);
    if (!property) throw new Error(`Unknown component property: ${definition.id}.${propertyName}`);
    if (typeof value !== property.type) throw new Error(`Component property ${definition.id}.${propertyName} must be ${property.type}`);
    instance.props[propertyName] = value;
  });
}

export function setComponentOverride<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
  override: ComponentOverride,
): T {
  return mutateInstance(graph, instanceId, (instance, definition) => {
    const templateIds = new Set<string>();
    walkNodes([definition.template], (node) => templateIds.add(node.id));
    if (!templateIds.has(override.target)) {
      throw new Error(`Component override target is unavailable: ${override.target}`);
    }
    const index = instance.overrides.findIndex((candidate) =>
      candidate.op === override.op && candidate.target === override.target);
    if (index >= 0) instance.overrides[index] = clone(override);
    else instance.overrides.push(clone(override));
  });
}

export function clearComponentOverride<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
  operation: ComponentOverride["op"],
  target: string,
): T {
  return mutateInstance(graph, instanceId, (instance) => {
    instance.overrides = instance.overrides.filter((candidate) =>
      candidate.op !== operation || candidate.target !== target);
  });
}

export function resetComponentInstance<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
): T {
  return mutateInstance(graph, instanceId, (instance, definition) => {
    instance.props = Object.fromEntries(definition.properties.flatMap((property) =>
      property.required && property.default === undefined && instance.props[property.name] !== undefined
        ? [[property.name, instance.props[property.name]!]]
        : []));
    instance.overrides = [];
    delete instance.variant;
    delete instance.state;
  });
}

export function detachComponentInstance<T extends SemanticInterfaceGraph>(
  graph: T,
  instanceId: string,
): T {
  const next = synchronizeComponentInstances(clone(graph));
  let target: SemanticNode | undefined;
  for (const screen of next.screens) target ??= findNode(screen.nodes, instanceId);
  if (!target?.componentInstance) throw new Error(`Unknown component instance: ${instanceId}`);
  delete target.componentInstance;
  return next;
}

export function updateComponentDefinition<T extends SemanticInterfaceGraph>(
  graph: T,
  definition: ComponentDefinition,
): T {
  const next = clone(graph);
  const index = next.components.findIndex((candidate) => candidate.id === definition.id);
  if (index < 0) throw new Error(`Unknown component definition: ${definition.id}`);
  next.components[index] = clone(definition);
  return synchronizeComponentInstances(next);
}

export function removeComponentDefinition<T extends SemanticInterfaceGraph>(
  graph: T,
  definitionId: string,
): T {
  const definition = graph.components.find((candidate) => candidate.id === definitionId);
  if (!definition) throw new Error(`Unknown component definition: ${definitionId}`);
  for (const candidate of graph.components) {
    if (candidate.id === definitionId) continue;
    let dependency = false;
    walkAuthoredNodes([candidate.template], (node) => {
      if (node.componentInstance?.definitionId === definitionId) dependency = true;
    });
    if (dependency) {
      throw new Error(`Component ${definitionId} is used by definition ${candidate.id}; detach that dependency first`);
    }
  }
  const next = synchronizeComponentInstances(clone(graph));
  for (const screen of next.screens) {
    walkNodes(screen.nodes, (node) => {
      if (node.componentInstance?.definitionId === definitionId) delete node.componentInstance;
    });
  }
  next.components = next.components.filter((candidate) => candidate.id !== definitionId);
  return next;
}

export function exportLocalComponentLibrary(
  graph: SemanticInterfaceGraph,
  metadata: { id: string; name: string; version: string },
  definitionIds: readonly string[] = graph.components.map((definition) => definition.id),
): LocalComponentLibrary {
  const definitionsById = new Map(graph.components.map((definition) => [definition.id, definition]));
  const definitions = definitionIds.map((id) => {
    const definition = definitionsById.get(id);
    if (!definition) throw new Error(`Unknown component definition: ${id}`);
    return clone(definition);
  });
  return {
    abiVersion: COMPONENT_LIBRARY_ABI_VERSION,
    id: metadata.id,
    name: metadata.name,
    version: metadata.version,
    definitions,
  };
}

export function importLocalComponentLibrary<T extends SemanticInterfaceGraph>(
  graph: T,
  library: LocalComponentLibrary,
  conflict: "error" | "replace" = "error",
): T {
  if (library.abiVersion !== COMPONENT_LIBRARY_ABI_VERSION) {
    throw new Error(`Unsupported component library ABI: ${library.abiVersion}`);
  }
  const next = clone(graph);
  const indexes = new Map(next.components.map((definition, index) => [definition.id, index]));
  for (const definition of library.definitions) {
    const index = indexes.get(definition.id);
    if (index !== undefined && conflict === "error") {
      throw new Error(`Component definition already exists: ${definition.id}`);
    }
    if (index === undefined) {
      indexes.set(definition.id, next.components.length);
      next.components.push(clone(definition));
    } else {
      next.components[index] = clone(definition);
    }
  }
  return synchronizeComponentInstances(next);
}
