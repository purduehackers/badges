import { createHash } from "node:crypto";
import { checkIds, criteria, includesMaterial, reviewMaterials } from "./contracts.ts";
import type { Review, Criterion } from "./contracts.ts";

export function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contextHash(review: Review): string {
  return hash(
    JSON.stringify({
      badge: review.badge?.hash,
      stamp: review.stamp?.hash,
      event: review.event,
      settings: review.settings,
      fittedSizeIn: review.fittedSizeIn,
      targetCount: review.targetCount,
      material: reviewMaterials(review)[0],
      ...(reviewMaterials(review).length > 1 ? { materials: reviewMaterials(review) } : {}),
      sheetBatch: review.sheetBatch,
      layout: review.selectedLayout,
      stockPlan: review.stockPlan,
      ...(review.stockReceipt ? { stockReceipt: review.stockReceipt } : {}),
      manufacturing: review.manufacturing,
      rubric: review.rubric,
    }),
  );
}

/** Confirmations bind the design and configured size, independent of automatic layout fitting. */
export function designHash(review: Review, role: Criterion): string {
  return hash(
    JSON.stringify({
      asset: review[role]?.hash,
      rubric: review.rubric,
      ...(role === "badge"
        ? {
            event: review.event,
            size: review.settings?.badgeSizeIn,
            material: reviewMaterials(review)[0],
            ...(reviewMaterials(review).length > 1 ? { materials: reviewMaterials(review) } : {}),
          }
        : { shortSide: review.settings?.stampSizeIn, impression: "unmirrored" }),
    }),
  );
}

export function staticPassed(review: Review): boolean {
  return ["badge", "stamp"].every((role) =>
    checkIds.every((id) =>
      review.checks.some(
        (check) =>
          check.role === role &&
          check.id === id &&
          check.status === "pass" &&
          check.evidenceId === (role === "badge" ? review.badge?.hash : review.stamp?.hash),
      ),
    ),
  );
}

export function remainingCriteria(review: Review): Criterion[] {
  return criteria.filter(
    (criterion) =>
      !review.decisions.some(
        (decision) =>
          decision.context === designHash(review, criterion) &&
          decision.criterion === criterion &&
          decision.verdict === "approve",
      ),
  );
}

export function reviewable(review: Review): boolean {
  return (
    review.rolesConfirmed &&
    staticPassed(review) &&
    review.event !== undefined &&
    review.settings !== undefined &&
    reviewMaterials(review).length > 0 &&
    review.manufacturing !== undefined
  );
}

export function ready(review: Review): boolean {
  return (
    reviewable(review) &&
    remainingCriteria(review).length === 0 &&
    Boolean(review.stockPlan?.every((sheet) => includesMaterial(reviewMaterials(review), sheet))) &&
    review.layouts.some(
      (layout) =>
        layout.id === review.selectedLayout &&
        layout.audited &&
        layout.sizeIn === badgeSize(review) &&
        review.targetCount !== undefined &&
        layout.count >= review.targetCount,
    )
  );
}

export function badgeSize(review: Review): number | undefined {
  return review.fittedSizeIn ?? review.settings?.badgeSizeIn;
}

export function invalidate(review: Review, role?: Criterion): Review {
  const {
    approval: _approval,
    pr: _pr,
    publication: _publication,
    failure: _failure,
    selectedLayout: _selectedLayout,
    stockPlan: _stockPlan,
    manufacturing: _manufacturing,
    contextChanged: _contextChanged,
    pendingRole: _pendingRole,
    quantityShortfall: _quantityShortfall,
    ...rest
  } = review;
  return {
    ...rest,
    generation: review.generation + 1,
    checks: role ? review.checks.filter((check) => check.role !== role) : [],
    previews: [],
    layouts: [],
    layoutAttempt: 0,
    decisions: review.decisions,
    ...(review.publication?.shortlink ? { previousShortlink: review.publication.shortlink } : {}),
  };
}
