/**
 * CHECK-PATH-PROVIDER0 — provider-neutral identity for inquiry-path suggestions.
 *
 * Providers propose routes through knowledge. They do not acquire standing,
 * admission, tool authority, or trust by being a path provider.
 */

export type InquiryPathProviderKind =
  | "public_reference"
  | "local_knowledge"
  | "organization"
  | "federated_domain"
  | "researcher"
  | "agent_proposal";

export interface InquiryPathProviderRef {
  id: string;
  label: string;
  kind: InquiryPathProviderKind;
}

export interface InquiryPathProvider<Context, Suggestion> {
  ref: InquiryPathProviderRef;
  suggest(context: Context): Suggestion[];
}

export const PUBLIC_COUNTERPEDIA_PATH_PROVIDER: InquiryPathProviderRef = {
  id: "counterpedia.public",
  label: "Public Counterpedia",
  kind: "public_reference",
};

export function providerScopedPathId(
  provider: InquiryPathProviderRef,
  providerLocalPathId: string,
): string {
  return `${provider.id}::${providerLocalPathId}`;
}
