export * from "./types";
export * from "./lexer";
export * from "./parser";
export * from "./engine";
export * from "./utils";
export * from "./indexes";
export * from "./cache";
export * from "./aggregates";
export * from "./compile";
export { SearchEngine, initEngine, searchJson, searchJsonPaged, validate, setCacheSize } from "./engine-class";

export const VERSION = "1.0.0";