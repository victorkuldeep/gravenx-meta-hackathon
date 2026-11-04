/**
 * Validate workspace - validation target resolution.
 *
 * Resolves the EXACT schema for an operation + direction + status +
 * media type. Never substitutes across operations, status codes, media
 * types or directions. Ambiguity blocks validation with an explanation.
 */

import type { ParsedContract, ValidationDirection, ValidationTarget } from "./types";

export interface TargetResolution {
  target?: ValidationTarget;
  blocked?: string;
}

/** Stable schema identity: operation + direction + status + media + dialect. */
export function schemaIdFor(
  contractId: string,
  operationId: string,
  direction: ValidationDirection,
  statusCode: string | undefined,
  mediaType: string
): string {
  return [contractId, operationId, direction, statusCode ?? "-", mediaType].join("|");
}

export function resolveTarget(
  contract: ParsedContract,
  operationId: string,
  direction: ValidationDirection,
  statusCode: string | undefined,
  mediaType: string
): TargetResolution {
  const op = contract.operations.find((o) => o.id === operationId);
  if (!op) return { blocked: "Selected operation is no longer in the contract." };

  if (direction === "request") {
    if (!op.request) return { blocked: "This operation defines no request body." };
    const content = op.request.contentTypes.find((c) => c.mediaType === mediaType);
    if (!content) return { blocked: `Media type ${mediaType} is not declared for this request.` };
    if (!content.supported || content.schema === undefined) {
      return { blocked: `Request media type ${mediaType} has no supported JSON schema. See contract diagnostics.` };
    }
    return {
      target: {
        operationId,
        direction,
        mediaType,
        schemaId: schemaIdFor(contract.id, operationId, direction, undefined, mediaType),
        dialect: contract.dialect ?? "https://json-schema.org/draft/2020-12/schema",
        schema: content.schema,
      },
    };
  }

  if (!statusCode) return { blocked: "Select a response status code." };
  // Exact status match only - never fall back to another status or `default`
  // unless the user explicitly selected `default`.
  const resp = op.responses.find((r) => r.statusCode === statusCode);
  if (!resp) return { blocked: `Status ${statusCode} is not declared for this operation.` };
  const content = resp.contentTypes.find((c) => c.mediaType === mediaType);
  if (!content) return { blocked: `Media type ${mediaType} is not declared for status ${statusCode}.` };
  if (!content.supported || content.schema === undefined) {
    if (resp.contentTypes.length === 0) return { blocked: `Status ${statusCode} declares no body - there is nothing to validate.` };
    return { blocked: `Status ${statusCode} / ${mediaType} has no supported JSON schema. See contract diagnostics.` };
  }
  return {
    target: {
      operationId,
      direction,
      statusCode,
      mediaType,
      schemaId: schemaIdFor(contract.id, operationId, direction, statusCode, mediaType),
      dialect: contract.dialect ?? "https://json-schema.org/draft/2020-12/schema",
      schema: content.schema,
    },
  };
}
