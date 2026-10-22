import type { Diagnostic } from "../core/types.js";
import { registry } from "../adapters/index.js";
import { checkHarnesses, checkRequiredBins, checkSharedSkills } from "./checks.js";
import {
  findExecutable,
  packageNodeRange,
  probeExecutableVersion,
  versionSatisfies,
} from "./probes.js";
import type { DoctorContext, DoctorOptions } from "./types.js";

export type { DoctorOptions } from "./types.js";

export async function runDoctor(options: DoctorOptions): Promise<readonly Diagnostic[]> {
  const env = options.env ?? process.env;
  const executableLookup = options.findExecutable ?? findExecutable;
  const executableCache = new Map<string, Promise<string | undefined>>();
  const context: DoctorContext = {
    snapshot: options.snapshot,
    model: options.model,
    env,
    adapters: options.adapters ?? registry,
    findExecutable(name) {
      const cached = executableCache.get(name);
      if (cached !== undefined) return cached;
      const result = executableLookup(name, env["PATH"], options.model.repoDir);
      executableCache.set(name, result);
      return result;
    },
    probeVersion: options.probeVersion ?? probeExecutableVersion,
  };

  const node = await packageNodeRange();
  const nodeVersion = options.nodeVersion ?? process.version;
  const nodeSupported = versionSatisfies(node.range, nodeVersion);
  const nodeDiagnostic: Diagnostic = {
    severity: nodeSupported ? "info" : "warn",
    code: nodeSupported ? "doctor.node.supported" : "doctor.node.unsupported",
    message: `Node ${nodeVersion} ${nodeSupported ? "satisfies" : "does not satisfy"} the package requirement ${node.range}.`,
    file: node.file,
    jsonPath: "/engines/node",
  };

  return [
    nodeDiagnostic,
    ...(await checkRequiredBins(context)),
    ...(await checkHarnesses(context)),
    ...(await checkSharedSkills(context)),
  ];
}
