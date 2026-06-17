export * from "./types.js";
export { createControlBus, assertCatalogFunctionAdvertised, stageCellSurface } from "./bus.js";
export { buildSurfaceFunctionIndex, findSurfaceFunctionByScope, mountSurfaceRegistry } from "./registry.js";
export { mergeBoardCellOnSurfaceMount, type MergeBoardCellOnSurfaceMountResult } from "./mount.js";
