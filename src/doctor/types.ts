import type {
  AdapterLoader,
  Environment,
  HarnessId,
  InputSnapshot,
  SourceModel,
} from "../core/types.js";
import type { ExecutableLookup, VersionProbe } from "./probes.js";

export interface DoctorOptions {
  readonly snapshot: InputSnapshot;
  readonly model: SourceModel;
  readonly env?: Environment;
  readonly adapters?: ReadonlyMap<HarnessId, AdapterLoader>;
  readonly findExecutable?: ExecutableLookup;
  readonly probeVersion?: VersionProbe;
  readonly nodeVersion?: string;
}

export interface DoctorContext {
  readonly snapshot: InputSnapshot;
  readonly model: SourceModel;
  readonly env: Environment;
  readonly adapters: ReadonlyMap<HarnessId, AdapterLoader>;
  readonly findExecutable: (name: string) => Promise<string | undefined>;
  readonly probeVersion: VersionProbe;
}
