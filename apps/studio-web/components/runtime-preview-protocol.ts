import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";

export const PREVIEW_REQUEST = "intentform.active-preview.request";
export const PREVIEW_READY = "intentform.active-preview.ready";
export const PREVIEW_STATUS = "intentform.active-preview.status";
export const PARITY_REQUEST = "intentform.runtime-parity.request";
export const PARITY_RESULT = "intentform.runtime-parity.result";
export const RUNTIME_PARITY_PROTOCOL_VERSION = 1;

export interface ActivePreviewRequest {
  type: typeof PREVIEW_REQUEST;
  fingerprint: string;
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
}

export interface ActivePreviewReady {
  type: typeof PREVIEW_READY;
}

export interface ActivePreviewStatus {
  type: typeof PREVIEW_STATUS;
  fingerprint: string;
  status: "ready" | "error";
  message?: string;
}

export interface RuntimeParityCollectRequest {
  type: typeof PARITY_REQUEST;
  version: typeof RUNTIME_PARITY_PROTOCOL_VERSION;
  requestId: string;
  graphFingerprint: string;
  compilerFingerprint: string;
  screenId: string;
}

export interface RuntimeParityCollectResult {
  type: typeof PARITY_RESULT;
  version: typeof RUNTIME_PARITY_PROTOCOL_VERSION;
  requestId: string;
  graphFingerprint: string;
  compilerFingerprint: string;
  screenId: string;
  collectedAt: string;
  nodes: unknown[];
}

export function isPreviewRequest(value: unknown): value is ActivePreviewRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActivePreviewRequest>;
  return candidate.type === PREVIEW_REQUEST
    && typeof candidate.fingerprint === "string"
    && typeof candidate.selectedScreen === "string"
    && typeof candidate.graph === "object";
}

export function isParityCollectRequest(value: unknown): value is RuntimeParityCollectRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RuntimeParityCollectRequest>;
  return candidate.type === PARITY_REQUEST
    && candidate.version === RUNTIME_PARITY_PROTOCOL_VERSION
    && typeof candidate.requestId === "string" && candidate.requestId.length > 0 && candidate.requestId.length <= 120
    && typeof candidate.graphFingerprint === "string" && candidate.graphFingerprint.length <= 128
    && typeof candidate.compilerFingerprint === "string" && candidate.compilerFingerprint.length <= 128
    && typeof candidate.screenId === "string" && candidate.screenId.length <= 240;
}

export function isParityCollectResult(value: unknown): value is RuntimeParityCollectResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RuntimeParityCollectResult>;
  return candidate.type === PARITY_RESULT
    && candidate.version === RUNTIME_PARITY_PROTOCOL_VERSION
    && typeof candidate.requestId === "string" && candidate.requestId.length > 0 && candidate.requestId.length <= 120
    && typeof candidate.graphFingerprint === "string" && candidate.graphFingerprint.length <= 128
    && typeof candidate.compilerFingerprint === "string" && candidate.compilerFingerprint.length <= 128
    && typeof candidate.screenId === "string" && candidate.screenId.length <= 240
    && typeof candidate.collectedAt === "string" && candidate.collectedAt.length <= 80
    && Array.isArray(candidate.nodes) && candidate.nodes.length <= 2_001;
}

export const WEB_PARITY_COLLECTOR = `<script>(()=>{const V=1,M=2001,C=1000000;const clamp=(v)=>Math.max(-C,Math.min(C,Number.isFinite(v)?v:0));const role=(el)=>el.getAttribute('role')||({BUTTON:'button',A:'link',INPUT:'textbox',SELECT:'combobox',TEXTAREA:'textbox',IMG:'img'}[el.tagName]||'generic');const name=(el)=>String(el.getAttribute('aria-label')||el.querySelector('[aria-label]')?.getAttribute('aria-label')||'').slice(0,240);const clipped=(el,r)=>{let p=el.parentElement;while(p){const s=getComputedStyle(p);if(/hidden|clip/.test(s.overflow+s.overflowX+s.overflowY)){const b=p.getBoundingClientRect();if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)return true}p=p.parentElement}return false};addEventListener('message',(event)=>{const q=event.data;if(event.source!==parent||!q||q.type!=='intentform.runtime-parity.request'||q.version!==V)return;const els=Array.from(document.querySelectorAll('[data-node-id]')).slice(0,M);const focus=Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter((el)=>!el.hasAttribute('disabled')&&el.getAttribute('tabindex')!=='-1');const nodes=els.map((el,i)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),text=el.firstElementChild?getComputedStyle(el.firstElementChild):s;return{nodeId:String(el.getAttribute('data-node-id')||'').slice(0,240),bounds:{x:clamp(r.x),y:clamp(r.y),width:clamp(r.width),height:clamp(r.height)},visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width>0&&r.height>0,accessibleName:name(el),computedRole:role(el),semanticOrder:i,tabOrder:focus.indexOf(el),position:s.position,clipped:clipped(el,r),fontMetrics:{size:clamp(parseFloat(text.fontSize)),lineHeight:clamp(parseFloat(text.lineHeight))}}});parent.postMessage({type:'intentform.runtime-parity.result',version:V,requestId:String(q.requestId).slice(0,120),graphFingerprint:String(q.graphFingerprint).slice(0,128),compilerFingerprint:String(q.compilerFingerprint).slice(0,128),screenId:String(q.screenId).slice(0,240),collectedAt:new Date().toISOString(),nodes},'*')})})();<\/script>`;

export function injectWebParityCollector(html: string): string {
  return html.includes("</body>") ? html.replace("</body>", `${WEB_PARITY_COLLECTOR}</body>`) : `${html}${WEB_PARITY_COLLECTOR}`;
}
