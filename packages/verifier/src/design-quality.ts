import {
  flattenSemanticNodes,
  resolveTokenMode,
  type GraphPatch,
  type PlatformTarget,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export const DESIGN_QUALITY_RULESET = {
  standard: "IntentForm Design Quality",
  version: "1.0.0",
  profileId: "design-quality",
} as const;

export type DesignQualityCategory = "typography" | "spacing" | "surfaces" | "color" | "hierarchy" | "interaction" | "responsiveness" | "components-tokens";

export interface DesignQualityEvidence {
  label: string;
  value: string | number | boolean;
}

export interface DesignQualityFinding {
  id: string;
  category: DesignQualityCategory;
  screenId: string;
  nodeIds: string[];
  propertyPaths: string[];
  severity: "info" | "warning" | "error";
  message: string;
  evidence: DesignQualityEvidence[];
  target: PlatformTarget;
  viewport: { width: number; height: number };
  visualState: string;
  ruleId: string;
  ruleVersion: string;
  suggestedRepair: {
    description: string;
    operations?: GraphPatch["operations"];
  };
  subjective: false;
}

export interface DesignQualityScenario {
  target: PlatformTarget;
  viewport: { width: number; height: number };
  visualState?: string;
}

type FindingInput = Omit<DesignQualityFinding, "id" | "target" | "viewport" | "visualState" | "ruleVersion" | "subjective">;

function nodeColors(node: SemanticNode): Array<{ path: string; color: string; token: string | undefined }> {
  const appearance = node.style.appearance;
  if (!appearance) return [];
  const values: Array<{ path: string; color: string; token: string | undefined }> = [];
  appearance.fills.forEach((fill, fillIndex) => {
    if (fill.type === "solid" && fill.color.color) values.push({ path: `style.appearance.fills.${fillIndex}.color`, color: fill.color.color, token: fill.color.token });
    if (fill.type === "linear-gradient") fill.stops.forEach((stop, stopIndex) => {
      if (stop.color.color) values.push({ path: `style.appearance.fills.${fillIndex}.stops.${stopIndex}.color`, color: stop.color.color, token: stop.color.token });
    });
  });
  if (appearance.stroke?.color.color) values.push({ path: "style.appearance.stroke.color", color: appearance.stroke.color.color, token: appearance.stroke.color.token });
  appearance.effects.forEach((effect, effectIndex) => {
    if ((effect.type === "shadow" || effect.type === "inner-shadow") && effect.color.color) values.push({ path: `style.appearance.effects.${effectIndex}.color`, color: effect.color.color, token: effect.color.token });
  });
  return values;
}

function structuralSignature(node: SemanticNode): string {
  return `${node.kind}(${node.children.map((child) => structuralSignature(child)).join(",")})`;
}

function actionNode(node: SemanticNode): boolean {
  return node.kind === "action" || node.kind === "primary-action" || node.kind === "secondary-action";
}

export function auditDesignQuality(graph: SemanticInterfaceGraph, scenario: DesignQualityScenario): DesignQualityFinding[] {
  const findings: DesignQualityFinding[] = [];
  const tokens = resolveTokenMode(graph.tokens);
  const visualState = scenario.visualState ?? "idle";
  const add = (input: FindingInput) => findings.push({
    ...input,
    id: `design-quality.${input.ruleId}.${input.screenId}.${input.nodeIds.join("+") || "project"}`,
    target: scenario.target,
    viewport: scenario.viewport,
    visualState,
    ruleVersion: DESIGN_QUALITY_RULESET.version,
    subjective: false,
  });

  for (const screen of graph.screens) {
    const nodes = flattenSemanticNodes(screen.nodes);
    const typographyNodes = nodes.filter((node) => node.style.appearance?.typography);
    const sized = typographyNodes.flatMap((node) => node.style.appearance?.typography?.size !== undefined ? [{ node, size: node.style.appearance.typography.size }] : []);
    const distinctSizes = [...new Set(sized.map((item) => item.size))].sort((left, right) => left - right);
    if (distinctSizes.length > 6) add({
      category: "typography", screenId: screen.id, nodeIds: sized.map((item) => item.node.id), propertyPaths: sized.map((item) => `${item.node.id}.style.appearance.typography.size`), severity: "warning", ruleId: "typography.size-diversity",
      message: `Typography uses ${distinctSizes.length} distinct font sizes on one screen.`,
      evidence: [{ label: "Font sizes", value: distinctSizes.join(", ") }, { label: "Recommended maximum", value: 6 }],
      suggestedRepair: { description: "Consolidate nearby sizes into named font-size tokens." },
    });
    for (const { node, size } of sized) {
      const typography = node.style.appearance!.typography!;
      if (["text", "status-message", "input"].includes(node.kind) && size < 12) add({
        category: "typography", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.style.appearance.typography.size`], severity: "error", ruleId: "typography.minimum-body-size",
        message: "Body text is below the deterministic 12px minimum.", evidence: [{ label: "Authored size", value: size }, { label: "Minimum", value: 12 }],
        suggestedRepair: { description: "Bind the text to a font-size token of at least 12px." },
      });
      if (typography.lineHeight && (typography.lineHeight / size < 1.1 || typography.lineHeight / size > 2)) add({
        category: "typography", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.style.appearance.typography.lineHeight`], severity: "warning", ruleId: "typography.line-height-ratio",
        message: "Line height falls outside the measurable 1.1–2.0 ratio.", evidence: [{ label: "Line-height ratio", value: Number((typography.lineHeight / size).toFixed(2)) }],
        suggestedRepair: { description: "Use a line-height token between 1.1× and 2× the font size." },
      });
      const matchingSizeToken = Object.entries(tokens.fontSizes).find(([, value]) => value === size)?.[0];
      if (matchingSizeToken && !typography.sizeToken) add({
        category: "typography", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.style.appearance.typography.size`], severity: "warning", ruleId: "typography.unbound-size-token",
        message: `A direct font size duplicates ${matchingSizeToken}.`, evidence: [{ label: "Direct value", value: size }, { label: "Matching token", value: matchingSizeToken }],
        suggestedRepair: { description: `Bind the layer to ${matchingSizeToken}.` },
      });
      if (typography.transform === "uppercase" && (node.intent.label?.length ?? 0) > 30) add({
        category: "typography", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.style.appearance.typography.transform`], severity: "warning", ruleId: "typography.excessive-uppercase",
        message: "A long label is transformed to uppercase.", evidence: [{ label: "Characters", value: node.intent.label?.length ?? 0 }],
        suggestedRepair: { description: "Remove uppercase transformation or shorten the label." },
      });
    }

    const longLabels = nodes.filter((node) => (node.intent.label?.length ?? 0) > 90);
    longLabels.forEach((node) => add({
      category: "typography", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.intent.label`], severity: "warning", ruleId: "typography.long-line",
      message: "Text content exceeds 90 characters and risks an unreadable line length.", evidence: [{ label: "Characters", value: node.intent.label?.length ?? 0 }],
      suggestedRepair: { description: "Split the content or constrain it with a readable text container." },
    }));

    const literalGaps = nodes.flatMap((node) => node.layout.gap !== undefined ? [{ node, gap: node.layout.gap }] : []);
    const spacingValues = new Set(Object.values(tokens.spacing));
    literalGaps.filter((item) => !spacingValues.has(item.gap)).forEach(({ node, gap }) => {
      const nearest = Object.entries(tokens.spacing).sort((left, right) => Math.abs(left[1] - gap) - Math.abs(right[1] - gap))[0];
      add({ category: "spacing", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.layout.gap`], severity: "warning", ruleId: "spacing.off-scale",
        message: "A literal gap falls outside the active spacing scale.", evidence: [{ label: "Literal gap", value: gap }, ...(nearest ? [{ label: "Nearest token", value: `${nearest[0]} (${nearest[1]}px)` }] : [])],
        suggestedRepair: nearest ? { description: `Bind the relationship to ${nearest[0]}.`, operations: [{ op: "set-gap-token", target: node.id, token: nearest[0] }] } : { description: "Add an intentional spacing token or use an existing scale value." },
      });
    });
    const distinctLiteralGaps = [...new Set(literalGaps.map((item) => item.gap))].sort((a, b) => a - b);
    if (distinctLiteralGaps.length >= 3 && distinctLiteralGaps.at(-1)! - distinctLiteralGaps[0]! <= 4) add({
      category: "spacing", screenId: screen.id, nodeIds: literalGaps.map((item) => item.node.id), propertyPaths: literalGaps.map((item) => `${item.node.id}.layout.gap`), severity: "warning", ruleId: "spacing.near-duplicates",
      message: "Near-duplicate gaps create an inconsistent spacing scale.", evidence: [{ label: "Literal gaps", value: distinctLiteralGaps.join(", ") }],
      suggestedRepair: { description: "Consolidate these relationships onto one spacing token." },
    });

    const radiusNodes = nodes.flatMap((node) => {
      const radius = node.style.appearance?.radius;
      return radius ? [{ node, values: [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft] }] : [];
    });
    const radiusValues = [...new Set(radiusNodes.flatMap((item) => item.values))];
    if (radiusValues.length > 5) add({
      category: "surfaces", screenId: screen.id, nodeIds: radiusNodes.map((item) => item.node.id), propertyPaths: radiusNodes.map((item) => `${item.node.id}.style.appearance.radius`), severity: "warning", ruleId: "surfaces.radius-diversity",
      message: `Surfaces use ${radiusValues.length} distinct radius values.`, evidence: [{ label: "Radii", value: radiusValues.sort((a, b) => a - b).join(", ") }],
      suggestedRepair: { description: "Consolidate radii into a small named token scale." },
    });
    const pills = radiusNodes.filter((item) => item.values.every((value) => value >= 999));
    if (pills.length >= 4) add({
      category: "surfaces", screenId: screen.id, nodeIds: pills.map((item) => item.node.id), propertyPaths: pills.map((item) => `${item.node.id}.style.appearance.radius`), severity: "warning", ruleId: "surfaces.excessive-pills",
      message: "Four or more layers use pill radii on one screen.", evidence: [{ label: "Pill layers", value: pills.length }],
      suggestedRepair: { description: "Reserve pill geometry for compact controls and statuses." },
    });

    const colors = nodes.flatMap((node) => nodeColors(node).map((color) => ({ node, ...color })));
    const literalColors = [...new Set(colors.map((item) => item.color.toLowerCase()))];
    if (literalColors.length > 12) add({
      category: "color", screenId: screen.id, nodeIds: [...new Set(colors.map((item) => item.node.id))], propertyPaths: colors.map((item) => `${item.node.id}.${item.path}`), severity: "warning", ruleId: "color.excessive-literals",
      message: `The screen contains ${literalColors.length} distinct literal colors.`, evidence: [{ label: "Distinct colors", value: literalColors.length }],
      suggestedRepair: { description: "Reduce competing literals and bind intentional roles to semantic color tokens." },
    });
    colors.forEach(({ node, path, color, token }) => {
      const match = Object.entries(tokens.colors).find(([, value]) => value.toLowerCase() === color.toLowerCase())?.[0];
      if (match && !token) add({
        category: "color", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.${path}`], severity: "warning", ruleId: "color.unbound-token",
        message: `A direct color duplicates ${match}.`, evidence: [{ label: "Literal color", value: color }, { label: "Matching token", value: match }],
        suggestedRepair: { description: `Bind the color to ${match}.` },
      });
    });

    nodes.filter((node) => node.kind === "primary-action" && node.style.emphasis !== "strong").forEach((node) => add({
      category: "hierarchy", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.style.emphasis`], severity: "error", ruleId: "hierarchy.primary-prominence",
      message: "The primary action is not authored with strong emphasis.", evidence: [{ label: "Current emphasis", value: node.style.emphasis }],
      suggestedRepair: { description: "Restore strong primary-action emphasis.", operations: [{ op: "set-emphasis", target: node.id, emphasis: "strong" }] },
    }));
    if (nodes.length > 40 && screen.nodes.every((node) => node.children.length === 0)) add({
      category: "hierarchy", screenId: screen.id, nodeIds: nodes.map((node) => node.id), propertyPaths: [`screens.${screen.id}.nodes`], severity: "warning", ruleId: "hierarchy.ungrouped-density",
      message: "A dense screen has no semantic grouping containers.", evidence: [{ label: "Ungrouped root layers", value: nodes.length }],
      suggestedRepair: { description: "Group related layers into semantic stack, grid, or section containers." },
    });

    const actions = nodes.filter(actionNode);
    actions.filter((node) => (node.layout.fixedWidth !== undefined && node.layout.fixedWidth < 44) || (node.layout.fixedHeight !== undefined && node.layout.fixedHeight < 44)).forEach((node) => add({
      category: "interaction", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.layout.fixedWidth`, `${node.id}.layout.fixedHeight`], severity: "error", ruleId: "interaction.minimum-target",
      message: "An action target is smaller than 44×44.", evidence: [{ label: "Width", value: node.layout.fixedWidth ?? "auto" }, { label: "Height", value: node.layout.fixedHeight ?? "auto" }],
      suggestedRepair: { description: "Increase the authored action bounds to at least 44×44." },
    }));
    const ambiguous = /^(click here|tap here|go|ok|yes|no)$/i;
    actions.filter((node) => ambiguous.test(node.intent.label?.trim() ?? "")).forEach((node) => add({
      category: "interaction", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.intent.label`], severity: "warning", ruleId: "interaction.ambiguous-label",
      message: "An action label does not describe its outcome.", evidence: [{ label: "Label", value: node.intent.label ?? "" }],
      suggestedRepair: { description: "Use a concise verb and outcome, such as Save changes or Delete file." },
    }));
    const actionLabels = new Map<string, SemanticNode[]>();
    actions.forEach((node) => { const key = node.intent.label?.trim().toLowerCase(); if (key) actionLabels.set(key, [...(actionLabels.get(key) ?? []), node]); });
    for (const [label, duplicates] of actionLabels) if (duplicates.length > 1) add({
      category: "interaction", screenId: screen.id, nodeIds: duplicates.map((node) => node.id), propertyPaths: duplicates.map((node) => `${node.id}.intent.label`), severity: "warning", ruleId: "interaction.duplicate-action",
      message: `Multiple actions share the label “${label}”.`, evidence: [{ label: "Duplicate actions", value: duplicates.length }],
      suggestedRepair: { description: "Differentiate each action by its specific outcome." },
    });

    nodes.filter((node) => node.layout.width === "fixed" && (node.layout.fixedWidth ?? 0) > scenario.viewport.width).forEach((node) => add({
      category: "responsiveness", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.layout.fixedWidth`], severity: "error", ruleId: "responsiveness.viewport-overflow",
      message: "A fixed-width layer exceeds the verification viewport.", evidence: [{ label: "Fixed width", value: node.layout.fixedWidth ?? 0 }, { label: "Viewport width", value: scenario.viewport.width }],
      suggestedRepair: { description: "Use fill, max-width, or a breakpoint override within the viewport." },
    }));

    const signatures = new Map<string, SemanticNode[]>();
    screen.nodes.forEach((node) => { if (node.componentInstance) return; const signature = structuralSignature(node); signatures.set(signature, [...(signatures.get(signature) ?? []), node]); });
    for (const repeated of signatures.values()) if (repeated.length >= 3 && repeated[0]!.children.length > 0) add({
      category: "components-tokens", screenId: screen.id, nodeIds: repeated.map((node) => node.id), propertyPaths: repeated.map((node) => `${node.id}.componentInstance`), severity: "info", ruleId: "components.repeated-structure",
      message: "Three or more equivalent structures are not component instances.", evidence: [{ label: "Repeated structures", value: repeated.length }],
      suggestedRepair: { description: "Review the repeated roots and create a local component when their intent is shared." },
    });
    nodes.filter((node) => Object.keys(node.componentInstance?.overrides ?? {}).length > 8).forEach((node) => add({
      category: "components-tokens", screenId: screen.id, nodeIds: [node.id], propertyPaths: [`${node.id}.componentInstance.overrides`], severity: "warning", ruleId: "components.excessive-overrides",
      message: "A component instance carries more than eight overrides.", evidence: [{ label: "Overrides", value: Object.keys(node.componentInstance?.overrides ?? {}).length }],
      suggestedRepair: { description: "Promote repeated overrides to component properties or a named variant." },
    }));
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}
