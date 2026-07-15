import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const entry = process.env.INTENTFORM_STUDIO_ENTRY;
if (!entry || !isAbsolute(entry)) throw new Error("The fixed packaged Studio entry is missing.");
await import(pathToFileURL(entry).href);
