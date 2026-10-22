/** A configured repository containing skills, before remote resolution. */
export interface ExternalSkillInput {
  readonly url: string;
  readonly ref?: string;
  readonly path?: string;
  readonly include?: readonly string[];
}

/** Reproducible external input, without machine-local cache paths. */
export interface ExternalRevision {
  readonly url: string;
  readonly ref?: string;
  readonly sha: string;
  readonly path: string;
}

/** Engine-owned checkout handed to read-only source discovery. */
export interface ResolvedExternalSkill {
  readonly revision: ExternalRevision;
  readonly directory: string;
  readonly index: number;
  readonly include?: readonly string[];
}
