// ManualClaimEntry creation (INFRA-1B.6).
// Implements ADR-0018 INV-0018-1/2/3/6:
//   - 3-way field separation: exactly one of user_written_claim / user_opinion / referenced_quote.
//   - referenced_quote requires quote_reason + attribution_json.
//   - raw_text_stored=false always (INV-0018-3, ADR-0012 INV-0012-3).
//   - Stored in Neo4j (ADR-0012 INV-0012-1); :RESOLVES edge created when interventionId is set.
//   - selfAssessedConfidence validated [0,1] and sourceAccessedVia validated for all paths.
//
// ID: mcl_<ULID> (ID_PREFIXES.ManualClaimEntry).

import { ulid } from "ulid";
import { withSession } from "../../storage/neo4j/connection";
import {
  isQuoteReason,
  isSourceAccessedVia,
  type QuoteReason,
  type SourceAccessedVia,
} from "../../utils/enums";

export type ClaimKind = "user_written_claim" | "user_opinion" | "referenced_quote";

export interface AttributionJson {
  publisher?: string;
  author?: string;
  title?: string;
  published_at?: string;
  url: string;
}

export interface ManualClaimInput {
  sessionId: string;
  sourceId: string;
  url: string;
  canonicalUrl?: string;
  title?: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  sourceAccessedAt: string;
  sourceAccessedVia: SourceAccessedVia;
  selfAssessedConfidence: number;     // 0–1
  interventionId?: string;

  // Exactly one must be set (INV-0018-1).
  userWrittenClaim?: string;
  userOpinion?: string;
  referencedQuote?: string;

  // Required only when referencedQuote is set (INV-0018-2).
  quoteReason?: QuoteReason;
  attribution?: AttributionJson;
}

export interface ManualClaimRecord {
  manualClaimId: string;
  kind: ClaimKind;
}

// ---------------------------------------------------------------------------
// Input validation (INV-0018-1/2).
// ---------------------------------------------------------------------------

export class ManualClaimValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualClaimValidationError";
  }
}

// A field is "set" only when it is a non-empty string. Empty strings ("") are
// treated as absent so callers cannot circumvent the exactly-one invariant by
// passing an empty value alongside a populated one.
function isSet(v: string | undefined): boolean {
  return typeof v === "string" && v.length > 0;
}

function validateInput(input: ManualClaimInput): ClaimKind {
  const setCount = [
    input.userWrittenClaim,
    input.userOpinion,
    input.referencedQuote,
  ].filter(isSet).length;

  if (setCount === 0) {
    throw new ManualClaimValidationError(
      "Exactly one of userWrittenClaim / userOpinion / referencedQuote must be provided (got none)."
    );
  }
  if (setCount > 1) {
    throw new ManualClaimValidationError(
      `Exactly one of userWrittenClaim / userOpinion / referencedQuote must be provided (got ${setCount}).`
    );
  }

  // Validate sourceAccessedVia and selfAssessedConfidence for ALL paths (INV-0018-6).
  if (!isSourceAccessedVia(input.sourceAccessedVia)) {
    throw new ManualClaimValidationError(
      `Invalid sourceAccessedVia: '${input.sourceAccessedVia}'.`
    );
  }

  const confidence = input.selfAssessedConfidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ManualClaimValidationError(
      "selfAssessedConfidence must be a finite number in [0, 1]."
    );
  }

  if (isSet(input.referencedQuote)) {
    if (!input.quoteReason || !isQuoteReason(input.quoteReason)) {
      throw new ManualClaimValidationError(
        "quoteReason is required when referencedQuote is set (INV-0018-2)."
      );
    }
    if (!input.attribution?.url) {
      throw new ManualClaimValidationError(
        "attribution.url is required when referencedQuote is set (INV-0018-2)."
      );
    }
    // ADR-0018: referenced_quote ≤200 Unicode code points (ADR-0015 INV-0015-1 short-quote
    // limit). Count with spread to correctly handle non-BMP characters (emoji, CJK ext.)
    // that occupy two UTF-16 code units but one code point.
    const cpLen = [...input.referencedQuote!].length;
    if (cpLen > 200) {
      throw new ManualClaimValidationError(
        `referenced_quote must be ≤200 characters (got ${cpLen}).`
      );
    }
    return "referenced_quote";
  }

  return isSet(input.userWrittenClaim) ? "user_written_claim" : "user_opinion";
}

// ---------------------------------------------------------------------------
// Neo4j write.
// ---------------------------------------------------------------------------

export async function createManualClaimEntry(
  input: ManualClaimInput
): Promise<ManualClaimRecord> {
  const kind = validateInput(input);
  const manualClaimId = `mcl_${ulid()}`;
  const now = new Date().toISOString();

  await withSession(async (session) => {
    const tx = session.beginTransaction();
    let commitAttempted = false;
    try {
      await tx.run(
        `CREATE (m:ManualClaimEntry {
           manual_claim_id:         $manualClaimId,
           session_id:              $sessionId,
           source_id:               $sourceId,
           url:                     $url,
           canonical_url:           $canonicalUrl,
           title:                   $title,
           publisher:               $publisher,
           author:                  $author,
           published_at:            $publishedAt,
           source_accessed_at:      $sourceAccessedAt,
           source_accessed_via:     $sourceAccessedVia,
           user_written_claim:      $userWrittenClaim,
           user_opinion:            $userOpinion,
           referenced_quote:        $referencedQuote,
           quote_reason:            $quoteReason,
           attribution_json:        $attributionJson,
           self_assessed_confidence: $selfAssessedConfidence,
           policy_gate_passed:      false,
           raw_text_stored:         false,
           intervention_id:         $interventionId,
           created_at:              $createdAt
         })`,
        {
          manualClaimId,
          sessionId: input.sessionId,
          sourceId: input.sourceId,
          url: input.url,
          canonicalUrl: input.canonicalUrl ?? input.url,
          title: input.title ?? null,
          publisher: input.publisher ?? null,
          author: input.author ?? null,
          publishedAt: input.publishedAt ?? null,
          sourceAccessedAt: input.sourceAccessedAt,
          sourceAccessedVia: input.sourceAccessedVia,
          // Normalize empty strings to null — isSet() treats "" as absent,
          // but `?? null` would still persist "". Use `|| null` to keep only
          // non-empty values, maintaining the 3-way separation invariant (INV-0018-1).
          userWrittenClaim: input.userWrittenClaim || null,
          userOpinion: input.userOpinion || null,
          referencedQuote: input.referencedQuote || null,
          quoteReason: input.quoteReason ?? null,
          attributionJson: input.attribution ? JSON.stringify(input.attribution) : null,
          selfAssessedConfidence: input.selfAssessedConfidence,
          interventionId: input.interventionId ?? null,
          createdAt: now,
        }
      );

      // Create :DERIVED_FROM_MANUAL_REVIEW_OF edge to Source (ADR-0018 projection edge).
      // sourceId is a required field; fail if the Source node doesn't exist so we don't
      // create orphan ManualClaimEntry nodes disconnected from the graph.
      const srcResult = await tx.run(
        `MATCH (m:ManualClaimEntry {manual_claim_id: $manualClaimId})
         MATCH (s:Source {source_id: $sourceId})
         CREATE (m)-[:DERIVED_FROM_MANUAL_REVIEW_OF]->(s)
         RETURN count(s) AS matched`,
        { manualClaimId, sourceId: input.sourceId }
      );
      const srcMatched = Number(srcResult.records[0]?.get("matched") ?? 0);
      if (srcMatched === 0) {
        throw new Error(
          `createManualClaimEntry: Source node not found for source_id='${input.sourceId}'.`
        );
      }

      // Create :RESOLVES edge when this entry resolves an AccessIntervention (ADR-0018).
      // Guard: throw if AccessIntervention node is missing to prevent dangling FK-like data.
      if (input.interventionId) {
        const intResult = await tx.run(
          `MATCH (m:ManualClaimEntry {manual_claim_id: $manualClaimId})
           MATCH (i:AccessIntervention {intervention_id: $interventionId})
           CREATE (m)-[:RESOLVES]->(i)
           RETURN count(i) AS matched`,
          { manualClaimId, interventionId: input.interventionId }
        );
        const intMatched = Number(intResult.records[0]?.get("matched") ?? 0);
        if (intMatched === 0) {
          throw new Error(
            `createManualClaimEntry: AccessIntervention not found for id='${input.interventionId}'.`
          );
        }
      }

      commitAttempted = true;
      await tx.commit();
    } catch (err) {
      // Do not attempt rollback after commit() has been called; Neo4j disallows it
      // and a secondary error would mask the original.
      if (!commitAttempted) {
        await tx.rollback();
      }
      throw err;
    }
  });

  return { manualClaimId, kind };
}
