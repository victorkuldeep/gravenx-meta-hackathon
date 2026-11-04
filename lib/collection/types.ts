export type CollectionMethod = "POST" | "PATCH" | "GET" | "DELETE";

export type CollectionKind = "rest" | "composite" | "graphql";

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  name: string;
  method: CollectionMethod;
  kind: CollectionKind;
  /** Full URL, e.g. https://myorg.my.salesforce.com/services/data/v66.0/sobjects/Account */
  url: string;
  /** Origin of the org, e.g. https://myorg.my.salesforce.com - becomes {{baseUrl}} on export */
  origin: string;
  body: unknown;
  createdAt: number;
}

export type NewCollectionItem = Omit<CollectionItem, "id" | "createdAt" | "collectionId">;

export function newItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
