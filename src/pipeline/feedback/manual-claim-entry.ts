// ManualClaimEntry creation (INFRA-1B.6).
// Implements ADR-0018 INV-0018-1/2/3/6:
//   - 3-way field separation: exactly one of user_written_claim / user_opinion / referenced_quote.
//   - referenced_quote requires quote_reason + attribution_json.
//   - raw_text_stored=false always (INV-0018-3, ADR-0012 INV-0012-3).
//   - Stored in Neo4j (ADR-0012 INV-0012-1).
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

function validateInput(input: ManualClaimInput): ClaimKind {
  const filled = [
    input.userWrittenClaim,
    input.userOpinion,
    input.referencedQuote,
  ].filter(Boolean);

  if (filled.length === 0) {
    throw new ManualClaimValidationError(
      "Exactly one of userWrittenClaim / userOpinion / referencedQuote must be provided (got none)."
    );
  }
  if (filled.length > 1) {
    throw new ManualClaimValidationError(
      `Exactly one of userWrittenClaim / userOpinion / referencedQuote must be provided (got ${filled.length}).`
    );
  }

  if (input.referencedQuote) {
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
    return "referenced_quote";
  }

  if (!isSourceAccessedVia(input.sourceAccessedVia)) {
    throw new ManualClaimValidationError(
      `Invalid sourceAccessedVia: '${input.sourceAccessedVia}'.`
    );
  }

  const confidence = input.selfAssessedConfidence;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    throw new ManualClaimValidationError(
      "selfAssessedConfidence must be a number in [0, 1]."
    );
  }

  return input.userWrittenClaim ? "user_written_claim" : "user_opinion";
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
           policy_gate_passed:      true,
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
          userWrittenClaim: input.userWrittenClaim ?? null,
          userOpinion: input.userOpinion ?? null,
          referencedQuote: input.referencedQuote ?? null,
          quoteReason: input.quoteReason ?? null,
          attributionJson: input.attribution ? JSON.stringify(input.attribution) : null,
          selfAssessedConfidence: input.selfAssessedConfidence,
          interventionId: input.interventionId ?? null,
          createdAt: now,
        }
      );

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });

  return { manualClaimId, kind };
}
