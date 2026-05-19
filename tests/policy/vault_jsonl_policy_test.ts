/**
 * tests/policy/vault_jsonl_policy_test.ts
 *
 * Operator decision D4 (2026-05-18) — pure config/policy validator tests for
 * ADR-0012 INV-0012-5 (Markdown vault content rules) + INV-0012-6 (JSONL
 * not canonical store).
 *
 * Two test classes:
 *   1. Integration: the live repo passes both assertions.
 *   2. Unit: synthetic file lists exercise positive + negative cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  findVaultFiles,
  findJsonlFiles,
  assertVaultContentKinds,
  assertPromotedClaimsAreCited,
  assertJsonlIsNotCanonical,
  checkVaultJsonlPolicy,
  VAULT_ROOTS,
  VAULT_FILE_EXTENSIONS,
  PERMITTED_VAULT_KINDS,
  ALLOWED_JSONL_PATH_PREFIXES,
  VaultJsonlPolicyError,
  type VaultFileEntry,
} from "../../scripts/check-vault-jsonl-policy";

function makeEntry(
  path: string,
  type: string | null,
  extras: { frontmatter?: Record<string, unknown>; body?: string } = {},
): VaultFileEntry {
  return {
    path,
    type,
    frontmatter: extras.frontmatter ?? (type === null ? null : { type }),
    body: extras.body ?? "",
  };
}

const REPO_ROOT = join(import.meta.dir, "..", "..");

// ---------------------------------------------------------------------------
// Integration — live repo
// ---------------------------------------------------------------------------

describe("vault-jsonl policy — live repo integration", () => {
  it("findVaultFiles returns [] when no vault root exists (current state)", () => {
    const files = findVaultFiles(REPO_ROOT);
    // Currently the repo has no vault root (vault/ / docs/vault/ absent).
    // This assertion will start exercising real files once the future vault
    // implementation lands; the test then verifies the live vault complies.
    expect(Array.isArray(files)).toBe(true);
  });

  it("live vault content satisfies INV-0012-5", () => {
    expect(() => assertVaultContentKinds(findVaultFiles(REPO_ROOT))).not.toThrow();
  });

  it("live JSONL files satisfy INV-0012-6 (all under allowlisted paths)", () => {
    expect(() => assertJsonlIsNotCanonical(findJsonlFiles(REPO_ROOT))).not.toThrow();
  });

  it("checkVaultJsonlPolicy aggregate passes on live repo", () => {
    expect(() => checkVaultJsonlPolicy(REPO_ROOT)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Synthetic vault content tests (INV-0012-5)
// ---------------------------------------------------------------------------

describe("assertVaultContentKinds — INV-0012-5", () => {
  it("passes on empty file list (vault not yet implemented)", () => {
    expect(() => assertVaultContentKinds([])).not.toThrow();
  });

  it("passes on file with permitted type 'dossier'", () => {
    const files: VaultFileEntry[] = [{ path: "vault/doss-1.md", type: "dossier" }];
    expect(() => assertVaultContentKinds(files)).not.toThrow();
  });

  it("passes on every permitted kind (canonical 7)", () => {
    const files: VaultFileEntry[] = [
      { path: "vault/hub.md", type: "document_hub" },
      { path: "vault/d.md", type: "dossier" },
      { path: "vault/s.md", type: "scenario" },
      { path: "vault/t.md", type: "thesis" },
      { path: "vault/cd.md", type: "content_draft" },
      { path: "vault/p.md", type: "publication" },
      { path: "vault/pc.md", type: "promoted_claim" },
    ];
    expect(() => assertVaultContentKinds(files)).not.toThrow();
  });

  it("normalizes case and separators ('Content Draft' / 'CONTENT-DRAFT' both pass)", () => {
    const files: VaultFileEntry[] = [
      { path: "vault/cd1.md", type: "Content Draft" },
      { path: "vault/cd2.md", type: "CONTENT-DRAFT" },
      { path: "vault/cd3.md", type: "contentDraft" },
    ];
    expect(() => assertVaultContentKinds(files)).not.toThrow();
  });

  it("throws when a vault file has missing type frontmatter", () => {
    const files: VaultFileEntry[] = [{ path: "vault/orphan.md", type: null }];
    expect(() => assertVaultContentKinds(files)).toThrow(VaultJsonlPolicyError);
    expect(() => assertVaultContentKinds(files)).toThrow(/missing 'type' frontmatter/);
  });

  it("throws when a vault file has a forbidden type (e.g. 'candidate_claim')", () => {
    const files: VaultFileEntry[] = [
      { path: "vault/claim-1.md", type: "candidate_claim" },
    ];
    expect(() => assertVaultContentKinds(files)).toThrow(VaultJsonlPolicyError);
    expect(() => assertVaultContentKinds(files)).toThrow(/forbidden type='candidate_claim'/);
  });

  it("throws when a vault file has 'note' / 'misc' / 'draft' type", () => {
    expect(() => assertVaultContentKinds([{ path: "vault/n.md", type: "note" }])).toThrow(VaultJsonlPolicyError);
    expect(() => assertVaultContentKinds([{ path: "vault/m.md", type: "misc" }])).toThrow(VaultJsonlPolicyError);
    expect(() => assertVaultContentKinds([{ path: "vault/d.md", type: "draft" }])).toThrow(VaultJsonlPolicyError);
  });

  it("reports every violation in one error (not fail-fast on first)", () => {
    const files: VaultFileEntry[] = [
      { path: "vault/a.md", type: "candidate_claim" },
      { path: "vault/b.md", type: null },
      { path: "vault/c.md", type: "note" },
    ];
    let thrown: Error | null = null;
    try {
      assertVaultContentKinds(files);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("vault/a.md");
    expect(thrown!.message).toContain("vault/b.md");
    expect(thrown!.message).toContain("vault/c.md");
  });

  it("VAULT_ROOTS and PERMITTED_VAULT_KINDS are exported", () => {
    expect(VAULT_ROOTS).toContain("vault");
    expect(VAULT_ROOTS).toContain("docs/vault");
    expect(PERMITTED_VAULT_KINDS.has("dossier")).toBe(true);
    expect(PERMITTED_VAULT_KINDS.has("publication")).toBe(true);
    expect(PERMITTED_VAULT_KINDS.has("promotedclaim")).toBe(true);
    expect(PERMITTED_VAULT_KINDS.has("candidateclaim")).toBe(false);
    expect(PERMITTED_VAULT_KINDS.has("note")).toBe(false);
  });

  // PR #94 codex review round 1 P2 — EditorialIntent kind (ADR-0025 accepted roadmap)
  it("accepts 'editorial_intent' type (ADR-0025 EditorialIntent kind)", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/editorial_intents/eit_abc.md", "editorial_intent"),
    ];
    expect(() => assertVaultContentKinds(files)).not.toThrow();
  });

  it("accepts 'EditorialIntent' / 'Editorial Intent' (normalized)", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/editorial_intents/a.md", "EditorialIntent"),
      makeEntry("vault/editorial_intents/b.md", "Editorial Intent"),
    ];
    expect(() => assertVaultContentKinds(files)).not.toThrow();
  });

  it("PERMITTED_VAULT_KINDS includes 'editorialintent' (ADR-0025 added)", () => {
    expect(PERMITTED_VAULT_KINDS.has("editorialintent")).toBe(true);
  });

  // PR #94 codex review round 1 P2 — MDX vault file support
  it("VAULT_FILE_EXTENSIONS includes both .md and .mdx (Astro Content Collection)", () => {
    expect(VAULT_FILE_EXTENSIONS).toContain(".md");
    expect(VAULT_FILE_EXTENSIONS).toContain(".mdx");
  });
});

// ---------------------------------------------------------------------------
// assertPromotedClaimsAreCited — INV-0012-5 scenario citation enforcement
// (PR #94 codex review round 1 P2)
// ---------------------------------------------------------------------------

describe("assertPromotedClaimsAreCited — INV-0012-5 scenario citation", () => {
  it("passes vacuously when no promoted_claim files exist", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/sc.md", "scenario"),
      makeEntry("vault/d.md", "dossier"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).not.toThrow();
  });

  it("passes when promoted_claim is cited via scenario frontmatter cited_claims[]", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s1.md", "scenario", {
        frontmatter: { type: "scenario", cited_claims: ["c_abc"] },
      }),
      makeEntry("vault/promoted_claims/c_abc.md", "promoted_claim"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).not.toThrow();
  });

  it("passes when promoted_claim is cited via scenario body markdown text", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s1.md", "scenario", {
        frontmatter: { type: "scenario" },
        body: "This scenario discusses claim c_abc in detail.",
      }),
      makeEntry("vault/promoted_claims/c_abc.md", "promoted_claim"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).not.toThrow();
  });

  it("passes when promoted_claim uses frontmatter claim_id (overrides filename)", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s1.md", "scenario", {
        frontmatter: { type: "scenario", cited_claims: ["c_real"] },
      }),
      makeEntry("vault/promoted_claims/random_slug.md", "promoted_claim", {
        frontmatter: { type: "promoted_claim", claim_id: "c_real" },
      }),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).not.toThrow();
  });

  it("throws when a promoted_claim is orphaned (no scenario citation)", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s1.md", "scenario", {
        frontmatter: { type: "scenario", cited_claims: ["c_other"] },
      }),
      makeEntry("vault/promoted_claims/c_orphan.md", "promoted_claim"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).toThrow(VaultJsonlPolicyError);
    expect(() => assertPromotedClaimsAreCited(files)).toThrow(/c_orphan.*not cited/);
  });

  it("throws when promoted_claim exists but NO scenarios at all", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/promoted_claims/c_first.md", "promoted_claim"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).toThrow(VaultJsonlPolicyError);
  });

  it("reports every orphaned promoted_claim in one error", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s.md", "scenario", {
        frontmatter: { type: "scenario", cited_claims: ["c_kept"] },
      }),
      makeEntry("vault/promoted_claims/c_kept.md", "promoted_claim"),
      makeEntry("vault/promoted_claims/c_drop1.md", "promoted_claim"),
      makeEntry("vault/promoted_claims/c_drop2.md", "promoted_claim"),
    ];
    let thrown: Error | null = null;
    try {
      assertPromotedClaimsAreCited(files);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("c_drop1");
    expect(thrown!.message).toContain("c_drop2");
    expect(thrown!.message).not.toContain("c_kept");
  });

  it("does NOT false-match prefix substrings in scenario body (whole-word check)", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s.md", "scenario", {
        frontmatter: { type: "scenario" },
        // 'c_abcd' contains 'c_abc' as a prefix but is NOT a whole-word match.
        body: "Reference to c_abcd here.",
      }),
      makeEntry("vault/promoted_claims/c_abc.md", "promoted_claim"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).toThrow(VaultJsonlPolicyError);
  });

  it("recognizes citation in scenario MDX body as well", () => {
    const files: VaultFileEntry[] = [
      makeEntry("vault/scenarios/s.mdx", "scenario", {
        frontmatter: { type: "scenario" },
        body: "We cite c_mdx in this MDX scenario.",
      }),
      makeEntry("vault/promoted_claims/c_mdx.mdx", "promoted_claim"),
    ];
    expect(() => assertPromotedClaimsAreCited(files)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Synthetic JSONL location tests (INV-0012-6)
// ---------------------------------------------------------------------------

describe("assertJsonlIsNotCanonical — INV-0012-6", () => {
  it("passes on empty file list (no JSONL anywhere)", () => {
    expect(() => assertJsonlIsNotCanonical([])).not.toThrow();
  });

  it("passes when JSONL is under .dev-cycle/", () => {
    expect(() => assertJsonlIsNotCanonical([".dev-cycle/briefs.jsonl"])).not.toThrow();
  });

  it("passes when JSONL is under docs/audit-export/", () => {
    expect(() => assertJsonlIsNotCanonical(["docs/audit-export/2026-05.jsonl"])).not.toThrow();
  });

  it("passes when JSONL is under docs/_generated/", () => {
    expect(() => assertJsonlIsNotCanonical(["docs/_generated/scope_tree.jsonl"])).not.toThrow();
  });

  it("passes when JSONL is under tests/fixtures/", () => {
    expect(() => assertJsonlIsNotCanonical(["tests/fixtures/sample.jsonl"])).not.toThrow();
  });

  it("throws when JSONL is in src/ (canonical-store violation)", () => {
    expect(() => assertJsonlIsNotCanonical(["src/data/claims.jsonl"])).toThrow(VaultJsonlPolicyError);
    expect(() => assertJsonlIsNotCanonical(["src/data/claims.jsonl"])).toThrow(/INV-0012-6/);
  });

  it("throws when JSONL is in data/ (canonical-store violation)", () => {
    expect(() => assertJsonlIsNotCanonical(["data/sources.jsonl"])).toThrow(VaultJsonlPolicyError);
  });

  it("throws when JSONL is in migrations/ (canonical-store violation)", () => {
    expect(() => assertJsonlIsNotCanonical(["migrations/sqlite/seed.jsonl"])).toThrow(VaultJsonlPolicyError);
  });

  it("throws when JSONL is in docs/adr/ (canonical decision authority)", () => {
    expect(() => assertJsonlIsNotCanonical(["docs/adr/0099-history.jsonl"])).toThrow(VaultJsonlPolicyError);
  });

  it("throws when JSONL is at repo root", () => {
    expect(() => assertJsonlIsNotCanonical(["packages.jsonl"])).toThrow(VaultJsonlPolicyError);
  });

  it("reports every violation in one error", () => {
    let thrown: Error | null = null;
    try {
      assertJsonlIsNotCanonical([
        "src/x.jsonl",
        ".dev-cycle/ok.jsonl",
        "data/y.jsonl",
      ]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("src/x.jsonl");
    expect(thrown!.message).toContain("data/y.jsonl");
    expect(thrown!.message).not.toContain(".dev-cycle/ok.jsonl");
  });

  it("ALLOWED_JSONL_PATH_PREFIXES exports documented intermediate paths", () => {
    expect(ALLOWED_JSONL_PATH_PREFIXES).toContain(".dev-cycle/");
    expect(ALLOWED_JSONL_PATH_PREFIXES).toContain("docs/audit-export/");
    expect(ALLOWED_JSONL_PATH_PREFIXES).toContain("docs/_generated/");
    expect(ALLOWED_JSONL_PATH_PREFIXES).toContain("tests/fixtures/");
  });
});

// ---------------------------------------------------------------------------
// Filesystem integration via tmpdir — round-trip for find* + assertions
// ---------------------------------------------------------------------------

describe("vault-jsonl policy — filesystem round-trip via tmpdir", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vault-jsonl-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("findVaultFiles enumerates files with frontmatter type", () => {
    mkdirSync(join(tmp, "vault"));
    writeFileSync(
      join(tmp, "vault", "d.md"),
      "---\ntype: dossier\ntitle: Test\n---\n\nBody.",
    );
    writeFileSync(
      join(tmp, "vault", "no-fm.md"),
      "Just body, no frontmatter.",
    );
    const files = findVaultFiles(tmp);
    expect(files).toHaveLength(2);
    const byPath = new Map(files.map((f) => [f.path, f.type]));
    expect(byPath.get("vault/d.md")).toBe("dossier");
    expect(byPath.get("vault/no-fm.md")).toBeNull();
  });

  it("findVaultFiles also scans docs/vault/ when present", () => {
    mkdirSync(join(tmp, "docs", "vault"), { recursive: true });
    writeFileSync(
      join(tmp, "docs", "vault", "p.md"),
      "---\ntype: publication\n---\n",
    );
    const files = findVaultFiles(tmp);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("docs/vault/p.md");
    expect(files[0]!.type).toBe("publication");
  });

  it("findJsonlFiles enumerates JSONL anywhere in the tree", () => {
    mkdirSync(join(tmp, ".dev-cycle"));
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, ".dev-cycle", "log.jsonl"), "");
    writeFileSync(join(tmp, "src", "leak.jsonl"), "");
    writeFileSync(join(tmp, "README.md"), ""); // non-jsonl ignored
    const files = findJsonlFiles(tmp);
    expect(new Set(files)).toEqual(new Set([".dev-cycle/log.jsonl", "src/leak.jsonl"]));
  });

  it("findJsonlFiles skips node_modules / .git", () => {
    mkdirSync(join(tmp, "node_modules"));
    mkdirSync(join(tmp, ".git"));
    writeFileSync(join(tmp, "node_modules", "vendor.jsonl"), "");
    writeFileSync(join(tmp, ".git", "internal.jsonl"), "");
    const files = findJsonlFiles(tmp);
    expect(files).toHaveLength(0);
  });

  it("checkVaultJsonlPolicy passes on a clean tmpdir (no vault, no JSONL)", () => {
    expect(() => checkVaultJsonlPolicy(tmp)).not.toThrow();
  });

  it("checkVaultJsonlPolicy throws on tmpdir with INV-0012-5 violation", () => {
    mkdirSync(join(tmp, "vault"));
    writeFileSync(
      join(tmp, "vault", "bad.md"),
      "---\ntype: candidate_claim\n---\n",
    );
    expect(() => checkVaultJsonlPolicy(tmp)).toThrow(VaultJsonlPolicyError);
  });

  it("checkVaultJsonlPolicy throws on tmpdir with INV-0012-6 violation", () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src", "canonical.jsonl"), "");
    expect(() => checkVaultJsonlPolicy(tmp)).toThrow(VaultJsonlPolicyError);
  });

  // PR #94 codex review round 1 P2 — MDX vault file scan
  it("findVaultFiles enumerates .mdx vault files (Astro publications)", () => {
    mkdirSync(join(tmp, "vault", "publications", "blog_long"), { recursive: true });
    writeFileSync(
      join(tmp, "vault", "publications", "blog_long", "post-a.mdx"),
      "---\ntype: publication\neditorial_intent_id: eit_a\n---\n\nBody.",
    );
    writeFileSync(
      join(tmp, "vault", "publications", "blog_long", "draft-b.md"),
      "---\ntype: content_draft\n---\n",
    );
    const files = findVaultFiles(tmp);
    expect(files).toHaveLength(2);
    const byPath = new Map(files.map((f) => [f.path, f.type]));
    expect(byPath.get("vault/publications/blog_long/post-a.mdx")).toBe("publication");
    expect(byPath.get("vault/publications/blog_long/draft-b.md")).toBe("content_draft");
  });

  it("MDX file with forbidden type fails assertVaultContentKinds (codex P2 regression)", () => {
    mkdirSync(join(tmp, "vault"), { recursive: true });
    writeFileSync(
      join(tmp, "vault", "fake.mdx"),
      "---\ntype: candidate_claim\n---\n",
    );
    expect(() => checkVaultJsonlPolicy(tmp)).toThrow(VaultJsonlPolicyError);
    expect(() => checkVaultJsonlPolicy(tmp)).toThrow(/candidate_claim/);
  });

  // PR #94 codex review round 1 P2 — scenario citation enforcement via tmpdir
  it("checkVaultJsonlPolicy throws when promoted_claim file is orphaned (no scenario citation)", () => {
    mkdirSync(join(tmp, "vault", "scenarios"), { recursive: true });
    mkdirSync(join(tmp, "vault", "promoted_claims"), { recursive: true });
    writeFileSync(
      join(tmp, "vault", "scenarios", "s.md"),
      "---\ntype: scenario\ncited_claims:\n  - c_kept\n---\n",
    );
    writeFileSync(
      join(tmp, "vault", "promoted_claims", "c_kept.md"),
      "---\ntype: promoted_claim\n---\n",
    );
    writeFileSync(
      join(tmp, "vault", "promoted_claims", "c_orphan.md"),
      "---\ntype: promoted_claim\n---\n",
    );
    expect(() => checkVaultJsonlPolicy(tmp)).toThrow(VaultJsonlPolicyError);
    expect(() => checkVaultJsonlPolicy(tmp)).toThrow(/c_orphan/);
  });

  it("checkVaultJsonlPolicy passes when all promoted_claims are cited (round-trip)", () => {
    mkdirSync(join(tmp, "vault", "scenarios"), { recursive: true });
    mkdirSync(join(tmp, "vault", "promoted_claims"), { recursive: true });
    writeFileSync(
      join(tmp, "vault", "scenarios", "s1.md"),
      "---\ntype: scenario\ncited_claims:\n  - c_a\n  - c_b\n---\n",
    );
    writeFileSync(
      join(tmp, "vault", "promoted_claims", "c_a.md"),
      "---\ntype: promoted_claim\n---\n",
    );
    writeFileSync(
      join(tmp, "vault", "promoted_claims", "c_b.md"),
      "---\ntype: promoted_claim\n---\n",
    );
    expect(() => checkVaultJsonlPolicy(tmp)).not.toThrow();
  });
});
