/**
 * ID prefix rules — AC-005 / TEST-005
 * Each domain object type has a required prefix (ADR-0011, ADR-0025, ADR-0024).
 */

export const ID_PREFIXES = {
  Source:             "src_",
  Document:           "doc_",
  Snapshot:           "snap_",
  Claim:              "clm_",
  Dossier:            "dos_",
  Scenario:           "scn_",
  EditorialIntent:    "eit_",
  Thesis:             "ths_",
  ContentDraft:       "drf_",
  Publication:        "pub_",
  EdgeRelation:       "edge_",
  Run:                "run_",
  AccessIntervention: "aci_",
  ManualClaimEntry:   "mcl_",
  DerivedMetric:      "met_",
  // Relational IDs
  PolicyDecision:     "pdec_",
  PolicyLearningEvent: "ple_",
  SourcePolicyRule:   "spr_",
  DatasetVintage:     "dvnt_",
  MetricsRun:         "mrun_",
  MetricAlert:        "malt_",
  EvaluationRun:      "eval_",
  EvaluationCase:     "ecase_",
  RetrievalPackMetric: "rpm_",
  CrossVendorReview:  "cvr_",
  ResearchSession:    "sess_",
  RawCacheItem:       "rcache_",
} as const;

export type DomainObjectType = keyof typeof ID_PREFIXES;

export function getExpectedPrefix(type: DomainObjectType): string {
  return ID_PREFIXES[type];
}

export function validateIdPrefix(type: DomainObjectType, id: string): boolean {
  return id.startsWith(ID_PREFIXES[type]);
}

export function assertIdPrefix(type: DomainObjectType, id: string): void {
  if (!validateIdPrefix(type, id)) {
    throw new Error(
      `ID '${id}' does not start with expected prefix '${ID_PREFIXES[type]}' for type '${type}'`
    );
  }
}

// ScenarioRevision has composite ID format: scn_<id>_r<n>
export function validateScenarioRevisionId(id: string): boolean {
  return /^scn_[A-Z0-9]+_r\d+$/i.test(id);
}
