declare module "mammoth" {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface MammothResult {
    /** Converted HTML fragment (no <html> wrapper). */
    value: string;
    /** Conversion caveats, e.g. unsupported elements that were dropped. */
    messages: MammothMessage[];
  }
  export function convertToHtml(
    input: { arrayBuffer?: ArrayBuffer; buffer?: Uint8Array },
    options?: unknown,
  ): Promise<MammothResult>;
}
