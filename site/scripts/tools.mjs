import { createRequire } from "node:module";
import { resolve } from "node:path";
export const toolsDir = resolve(process.env.PVP_TOOLS || "/tmp/pvp-pad-tools");
export const requireTool = createRequire(resolve(toolsDir, "package.json"));
