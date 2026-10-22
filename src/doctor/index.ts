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
import { installedExternals } from "../engine/external/state.js";
import { parseExternalUrl } from "../engine/external/url.js";
import { externalDiagnostics, skillDiagnosticSources } from "../engine/diagnostics.js";

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
  const installed = await installedExternals(options.snapshot.config);
  const external: Diagnostic[] = (options.snapshot.config.skills.external ?? []).map(
    (input, index) => {
      const parsed = parseExternalUrl(input);
      const revision = installed.find(
        (entry) =>
          entry.url === input.url && entry.ref === parsed.ref && entry.path === parsed.path,
      );
      return {
        severity: "info",
        code: "doctor.external",
        message: `${input.url} ${parsed.ref ?? "latest"} ${revision ? revision.sha.slice(0, 8) : "not installed"}; run skillerie outdated to check upstream.`,
        file: `${options.snapshot.config.paths.repo}/skillerie.yaml`,
        jsonPath: `/skills/external/${index}`,
      };
    },
  );

  return externalDiagnostics(
    [
      nodeDiagnostic,
      ...external,
      ...(await checkRequiredBins(context)),
      ...(await checkHarnesses(context)),
      ...(await checkSharedSkills(context)),
    ],
    skillDiagnosticSources(options.model),
  );
}
