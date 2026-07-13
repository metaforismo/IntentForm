import {
  parseGraph,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

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
  layout: { axis: "vertical", width: "fill", gapToken: "space.16", paddingToken: "space.20" },
  style: { role: kind, emphasis: importance === "primary" ? "strong" : "normal" },
  accessibility: { label, live: kind === "status-message" ? "polite" : "off" },
  states: [],
  interactions: [],
  provenance: { author: "system", revision: 0 },
});

const primaryAction = (
  screenId: string,
  label: string,
  compact: "inline" | "persistent-bottom",
  event: string,
): SemanticNode => ({
  ...baseNode(`${screenId}.confirm`, "primary-action", "Advance the product flow", label, "primary"),
  layout: {
    axis: "vertical",
    width: "fill",
    gapToken: "space.16",
    paddingToken: "space.20",
    placement: { compact, regular: "inline" },
  },
  interactions: [{ event, requires: [] }],
});

export const demoBrief =
  "Create a calm payment flow for independent professionals. Keep the amount, recipient and next action unmistakable. Never expose blockchain terminology. Every failure must provide a recovery path.";

export const demoGraph: SemanticInterfaceGraph = parseGraph({
  schemaVersion: "0.1.0",
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
    colors: {
      "color.accent": "#397461",
      "color.ink": "#181c1a",
      "color.canvas": "#f3f5f1",
      "color.surface": "#fbfcf9",
    },
    spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
    radii: { "radius.control": 18, "radius.surface": 28 },
  },
  platforms: [
    { target: "react", enabled: true, capabilities: ["responsive-layout", "aria", "sticky-actions"] },
    { target: "swiftui", enabled: true, capabilities: ["safe-area", "dynamic-type", "native-controls"] },
  ],
  components: [
    { id: "intent.balance-summary", kind: "balance-summary", description: "A prioritized account balance." },
    { id: "intent.money-input", kind: "money-input", description: "A currency-aware amount field." },
    { id: "intent.primary-action", kind: "primary-action", description: "The single dominant action." },
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
      data: [{ name: "balance", type: "money", required: true }],
      events: [{ name: "onRequestPayment" }],
      visualStates: ["idle", "loading"],
      fixtures: ["home.idle"],
    },
    {
      screenId: "payment-request",
      data: [
        { name: "amount", type: "money", required: true },
        { name: "recipientName", type: "string", required: true },
        { name: "status", type: "status", required: true },
      ],
      events: [{ name: "onConfirm" }, { name: "onCancel" }, { name: "onRetry" }],
      visualStates: ["idle", "loading", "failed", "completed"],
      fixtures: ["payment-request.idle", "payment-request.failed"],
    },
    {
      screenId: "receipt",
      data: [{ name: "reference", type: "string", required: true }],
      events: [{ name: "onDone" }],
      visualStates: ["completed"],
      fixtures: ["receipt.completed"],
    },
  ],
  fixtures: [
    { id: "home.idle", screenId: "home", state: "idle", data: { balance: "8420.16" } },
    { id: "payment-request.idle", screenId: "payment-request", state: "idle", data: { amount: "120.00", recipientName: "Mara Rinaldi", status: "idle" } },
    { id: "payment-request.failed", screenId: "payment-request", state: "failed", data: { amount: "120.00", recipientName: "Mara Rinaldi", status: "failed" } },
    { id: "receipt.completed", screenId: "receipt", state: "completed", data: { reference: "IF-2048" } },
  ],
});
