import {
  parseGraph,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

const baseLayout = (
  overrides: Partial<SemanticNode["layout"]> = {},
): SemanticNode["layout"] => ({
  axis: "vertical",
  width: "fill",
  height: "hug",
  align: "stretch",
  justify: "start",
  overflow: "visible",
  columns: 2,
  splitRatio: 0.5,
  gapToken: "space.16",
  paddingToken: "space.20",
  ...overrides,
});

const baseNode = (
  id: string,
  kind: SemanticNode["kind"],
  purpose: string,
  label: string,
  importance: "primary" | "secondary" | "supporting" = "supporting",
): SemanticNode => ({
  id,
  kind,
  intent: { purpose, label, importance },
  layout: baseLayout(),
  style: { role: kind, emphasis: importance === "primary" ? "strong" : "normal" },
  accessibility: { label, live: kind === "status-message" ? "polite" : "off" },
  states: [],
  interactions: [],
  provenance: { author: "system", revision: 0 },
  children: [],
});

const containerNode = (
  id: string,
  kind: Extract<SemanticNode["kind"], "stack" | "grid" | "overlay" | "scroll" | "safe-area" | "adaptive" | "wrap" | "split" | "freeform" | "page-flow">,
  children: SemanticNode[],
  layout: Partial<SemanticNode["layout"]> = {},
): SemanticNode => ({
  ...baseNode(id, kind, `Arrange the ${id} content`, id),
  layout: baseLayout({
    gapToken: "space.12",
    paddingToken: "space.16",
    ...layout,
  }),
  children,
});

const positionedLeaf = (id: string, x: number, y: number, z: number): SemanticNode => {
  const leaf = baseNode(id, "status-message", `Show the ${id} layout sample`, id);
  leaf.layout.position = { x, y, z };
  return leaf;
};

const primaryAction = (
  screenId: string,
  label: string,
  compact: "inline" | "persistent-bottom",
  event: string,
): SemanticNode => ({
  ...baseNode(`${screenId}.confirm`, "primary-action", "Advance the product flow", label, "primary"),
  layout: baseLayout({
    placement: { compact, regular: "inline" },
  }),
  interactions: [{ event, requires: [] }],
});

export const demoBrief =
  "Create a calm payment flow for independent professionals. Keep the amount, recipient and next action unmistakable. Never expose blockchain terminology. Every failure must provide a recovery path.";

export const demoGraph: SemanticInterfaceGraph = parseGraph({
  schemaVersion: "0.4.0",
  product: {
    name: "Verdant Pay",
    audience: ["independent professionals", "non-technical customers"],
    principles: [
      "Never expose implementation terminology",
      "Keep one primary action obvious",
      "Every error provides a recovery path",
    ],
  },
  tokens: {
    defaultMode: "default",
    activeMode: "default",
    modes: {
      default: {
        name: "Default",
        values: {
          colors: {
            "color.accent": "#397461",
            "color.ink": "#181c1a",
            "color.canvas": "#f3f5f1",
            "color.surface": "#fbfcf9",
          },
          spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
          radii: { "radius.control": 18, "radius.surface": 28 },
        },
      },
      evening: {
        name: "Evening",
        description: "A low-light brand mode with the same semantic token contract.",
        values: {
          colors: {
            "color.accent": "#68a990",
            "color.ink": "#eef4f0",
            "color.canvas": "#111714",
            "color.surface": "#18211d",
          },
          spacing: {},
          radii: {},
        },
      },
    },
    aliases: { "color.action": "color.accent" },
    deprecated: {},
    extensions: {},
  },
  assets: [],
  platforms: [
    { target: "react", enabled: true, capabilities: ["responsive-layout", "aria", "sticky-actions"] },
    { target: "swiftui", enabled: true, capabilities: ["safe-area", "dynamic-type", "native-controls"] },
  ],
  components: [
    {
      id: "intent.balance-summary",
      name: "Balance summary",
      description: "A prioritized account balance.",
      version: "1.0.0",
      template: baseNode("balance.root", "balance-summary", "Show an account balance", "Available balance", "primary"),
      properties: [{
        name: "label",
        type: "string",
        required: false,
        default: "Available balance",
        bindings: [
          { target: "balance.root", field: "intent.label" },
          { target: "balance.root", field: "accessibility.label" },
        ],
      }],
      slots: [],
      variants: [],
      states: [],
    },
    {
      id: "intent.money-input",
      name: "Money input",
      description: "A currency-aware amount field.",
      version: "1.0.0",
      template: baseNode("money.root", "money-input", "Capture a monetary amount", "Amount", "primary"),
      properties: [{
        name: "label",
        type: "string",
        required: true,
        default: "Amount",
        bindings: [
          { target: "money.root", field: "intent.label" },
          { target: "money.root", field: "accessibility.label" },
        ],
      }],
      slots: [],
      variants: [],
      states: [],
    },
    {
      id: "intent.primary-action",
      name: "Primary action",
      description: "The single dominant action.",
      version: "1.1.0",
      template: baseNode("action.root", "primary-action", "Advance the product flow", "Continue", "primary"),
      properties: [{
        name: "label",
        type: "string",
        required: true,
        default: "Continue",
        bindings: [
          { target: "action.root", field: "intent.label" },
          { target: "action.root", field: "accessibility.label" },
        ],
      }],
      slots: [],
      variants: [
        { id: "prominent", label: "Prominent", overrides: [{ op: "set-emphasis", target: "action.root", value: "strong" }] },
        { id: "quiet", label: "Quiet", overrides: [{ op: "set-emphasis", target: "action.root", value: "quiet" }] },
      ],
      defaultVariant: "prominent",
      states: [
        { id: "ready", label: "Ready", overrides: [] },
        { id: "working", label: "Working", overrides: [{ op: "set-label", target: "action.root", value: "Working…" }] },
      ],
      defaultState: "ready",
    },
    {
      id: "intent.surface-card",
      name: "Surface card",
      description: "A reusable semantic surface with a typed content slot.",
      version: "1.0.0",
      template: containerNode("card.root", "stack", [], { gapToken: "space.12", paddingToken: "space.20" }),
      properties: [],
      slots: [{
        name: "content",
        target: "card.root",
        allowedKinds: ["balance-summary", "transaction-list", "money-input", "recipient-identity", "primary-action", "secondary-action", "status-message", "receipt-summary", "stack", "grid", "overlay", "scroll", "safe-area", "adaptive", "wrap", "split", "freeform", "page-flow"],
        required: false,
        maxChildren: 12,
      }],
      variants: [
        { id: "comfortable", label: "Comfortable", overrides: [{ op: "set-gap-token", target: "card.root", value: "space.16" }] },
        { id: "compact", label: "Compact", overrides: [{ op: "set-gap-token", target: "card.root", value: "space.8" }] },
      ],
      defaultVariant: "comfortable",
      states: [],
    },
  ],
  screens: [
    {
      id: "home",
      title: "Good evening",
      purpose: "See balance and recent activity",
      route: "/",
      nodes: [
        baseNode("home.balance", "balance-summary", "Show spendable balance", "Available balance", "primary"),
        baseNode("home.activity", "transaction-list", "Show recent activity", "Recent activity"),
        primaryAction("home", "Request payment", "persistent-bottom", "onRequestPayment"),
      ],
    },
    {
      id: "payment-request",
      title: "Request payment",
      purpose: "Confirm a payment request",
      route: "/request",
      nodes: [
        baseNode("payment-request.amount", "money-input", "Capture the requested amount", "Amount", "primary"),
        baseNode("payment-request.recipient", "recipient-identity", "Confirm the recipient", "Recipient"),
        {
          ...baseNode("payment-request.failure", "status-message", "Explain a recoverable failure", "Payment could not be sent. Check the amount and try again."),
          states: [{ name: "failed", visibleWhen: { op: "eq", left: { op: "field", path: "data.status" }, right: { op: "value", value: "failed" } } }],
        },
        primaryAction("payment-request", "Confirm request", "inline", "onConfirm"),
      ],
    },
    {
      id: "receipt",
      title: "Request sent",
      purpose: "Confirm completion and reference",
      route: "/receipt",
      nodes: [
        baseNode("receipt.summary", "receipt-summary", "Show completion evidence", "Payment request sent", "primary"),
        primaryAction("receipt", "Done", "persistent-bottom", "onDone"),
      ],
    },
    {
      id: "layout-lab",
      title: "Layout lab",
      purpose: "Exercise every recursive layout relation",
      route: "/layout-lab",
      nodes: [
        containerNode("layout-lab.adaptive", "adaptive", [
          containerNode("layout-lab.safe-area", "safe-area", [
            containerNode("layout-lab.grid", "grid", [
              baseNode("layout-lab.grid-a", "status-message", "Show the first grid sample", "Grid A"),
              baseNode("layout-lab.grid-b", "status-message", "Show the second grid sample", "Grid B"),
            ], { columns: 2 }),
          ]),
          containerNode("layout-lab.overlay", "overlay", [
            baseNode("layout-lab.overlay-a", "status-message", "Show the overlay base", "Overlay base"),
            baseNode("layout-lab.overlay-b", "status-message", "Show the overlay foreground", "Overlay foreground"),
          ], { axis: "overlay" }),
          containerNode("layout-lab.scroll", "scroll", [
            containerNode("layout-lab.wrap", "wrap", [
              baseNode("layout-lab.wrap-a", "status-message", "Show the first wrapped sample", "Wrap A"),
              baseNode("layout-lab.wrap-b", "status-message", "Show the second wrapped sample", "Wrap B"),
            ], { axis: "horizontal", columns: 2 }),
          ], { axis: "horizontal", overflow: "scroll" }),
          containerNode("layout-lab.split", "split", [
            containerNode("layout-lab.page-flow", "page-flow", [
              baseNode("layout-lab.page", "status-message", "Show the page flow sample", "Page flow"),
            ]),
            containerNode("layout-lab.stack", "stack", [
              baseNode("layout-lab.stack-item", "status-message", "Show the stack sample", "Stack"),
            ]),
          ], { axis: "horizontal", splitRatio: 0.4 }),
          containerNode("layout-lab.freeform", "freeform", [
            positionedLeaf("layout-lab.freeform-a", 12, 18, 2),
            positionedLeaf("layout-lab.freeform-b", 84, 44, 1),
          ], { height: "fixed", fixedHeight: 180, overflow: "clip" }),
        ], { adaptive: { compact: "stack", regular: "grid" }, columns: 2 }),
      ],
    },
  ],
  flows: [
    {
      id: "request-payment",
      steps: [
        { from: "home", event: "onRequestPayment", to: "payment-request" },
        { from: "payment-request", event: "onConfirm", to: "receipt" },
      ],
    },
  ],
  contracts: [
    {
      screenId: "home",
      data: [
        { name: "balance", type: "money", required: true },
        { name: "activitySummary", type: "string", required: true },
      ],
      events: [{ name: "onRequestPayment" }],
      visualStates: ["idle", "loading"],
      fixtures: ["home.idle"],
    },
    {
      screenId: "payment-request",
      data: [
        { name: "amount", type: "money", required: true },
        { name: "recipientName", type: "string", required: true },
        { name: "recipientHandle", type: "string", required: true },
        { name: "status", type: "status", required: true },
      ],
      events: [{ name: "onConfirm" }, { name: "onCancel" }, { name: "onRetry" }],
      visualStates: ["idle", "loading", "failed", "completed"],
      fixtures: ["payment-request.idle", "payment-request.failed"],
    },
    {
      screenId: "receipt",
      data: [
        { name: "reference", type: "string", required: true },
        { name: "amount", type: "money", required: true },
      ],
      events: [{ name: "onDone" }],
      visualStates: ["completed"],
      fixtures: ["receipt.completed"],
    },
  ],
  fixtures: [
    { id: "home.idle", screenId: "home", state: "idle", data: { balance: "8420.16", activitySummary: "Riva Studio −84.20 · Northline Market −32.70" } },
    { id: "payment-request.idle", screenId: "payment-request", state: "idle", data: { amount: "120.00", recipientName: "Mara Rinaldi", recipientHandle: "mara@northline.test", status: "idle" } },
    { id: "payment-request.failed", screenId: "payment-request", state: "failed", data: { amount: "120.00", recipientName: "Mara Rinaldi", recipientHandle: "mara@northline.test", status: "failed" } },
    { id: "receipt.completed", screenId: "receipt", state: "completed", data: { reference: "IF-2048", amount: "120.00" } },
  ],
});
