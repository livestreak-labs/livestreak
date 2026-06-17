import { randomUUID } from "node:crypto";

export const createOpaqueArtifactId = (): string => `art_${randomUUID()}`;
