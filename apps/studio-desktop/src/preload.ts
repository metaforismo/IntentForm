import { contextBridge, ipcRenderer } from "electron";
import {
  desktopIpcChannels,
  desktopSnapshotSchema,
  externalUrlRequestSchema,
  serviceCommandSchema,
  type IntentFormDesktopApi,
} from "@intentform/desktop-bridge";

const invokeSnapshot = async (channel: string, input?: unknown) => desktopSnapshotSchema.parse(
  await ipcRenderer.invoke(channel, input),
);

const api: IntentFormDesktopApi = Object.freeze({
  runtimeSecurity: Object.freeze({
    rendererSandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
  }),
  snapshot: () => invokeSnapshot(desktopIpcChannels.snapshot),
  chooseProject: () => invokeSnapshot(desktopIpcChannels.chooseProject),
  refreshToolchains: () => invokeSnapshot(desktopIpcChannels.refreshToolchains),
  refreshGit: () => invokeSnapshot(desktopIpcChannels.refreshGit),
  setService: (input: Parameters<IntentFormDesktopApi["setService"]>[0]) => invokeSnapshot(desktopIpcChannels.setService, serviceCommandSchema.parse(input)),
  copyMcpConfiguration: async () => {
    await ipcRenderer.invoke(desktopIpcChannels.copyMcpConfiguration);
  },
  openExternal: async (input: Parameters<IntentFormDesktopApi["openExternal"]>[0]) => {
    await ipcRenderer.invoke(desktopIpcChannels.openExternal, externalUrlRequestSchema.parse(input));
  },
  checkForUpdates: () => invokeSnapshot(desktopIpcChannels.checkForUpdates),
  onChanged: (listener: Parameters<IntentFormDesktopApi["onChanged"]>[0]) => {
    const receive = (_event: Electron.IpcRendererEvent, input: unknown) => listener(desktopSnapshotSchema.parse(input));
    ipcRenderer.on(desktopIpcChannels.changed, receive);
    return () => ipcRenderer.removeListener(desktopIpcChannels.changed, receive);
  },
});

contextBridge.exposeInMainWorld("intentformDesktop", api);
