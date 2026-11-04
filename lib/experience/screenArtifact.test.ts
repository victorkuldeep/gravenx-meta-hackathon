import { describe, expect, it } from "vitest";
import {
  buildScreenArtifact,
  importScreenArtifact,
  parseScreenArtifact,
} from "./screenArtifact";
import type { StudioProject } from "@/lib/studio/types";

function project(): StudioProject {
  return {
    id: "ws1", name: "W", mappingIds: [], createdAt: "", updatedAt: "",
    apiCatalog: {
      id: "api", operations: [
        { id: "op1", operationKey: "POST /sobjects/Lead", name: "Lead create", method: "POST", path: "/sobjects/Lead", layer: "salesforce", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "", updatedAt: "" },
      ],
      dependencies: [], updatedAt: "",
    },
    experience: {
      screens: [
        { id: "s1", name: "Capture", journeyIds: [], componentIds: ["c1"], actionIds: [], bindingIds: ["b1"], status: "draft", tags: [], createdAt: "", updatedAt: "", canvas: { sourceWidth: 1, sourceHeight: 1, aspectRatio: 1 } },
      ],
      components: [
        { id: "c1", screenId: "s1", name: "Email", componentType: "input", requirementIds: ["r1"], bindingIds: ["b1"], actionIds: [], stateIds: [], status: "draft", tags: [], createdAt: "", updatedAt: "" },
      ],
      annotations: [{ id: "a1", screenId: "s1", label: "R1", geometry: { x: 0, y: 0, width: 1, height: 1, coordinateSpace: "source-pixels" }, zIndex: 0, createdAt: "", updatedAt: "" }],
      actions: [], journeys: [], transitions: [],
      requirements: [
        { id: "r1", screenId: "s1", componentId: "c1", bindingId: "b1", name: "Lead.Email", direction: "request", required: true, source: "contract", status: "draft", createdAt: "", updatedAt: "" },
      ],
      states: [],
      bindings: [
        { id: "b1", screenId: "s1", componentId: "c1", operationId: "op1", usage: "create", trigger: "user-action", requestRequirementIds: ["r1"], responseRequirementIds: [], stateIds: [], status: "proposed", createdAt: "", updatedAt: "" },
      ],
      createdAt: "", updatedAt: "",
    },
  } as unknown as StudioProject;
}

describe("screenArtifact", () => {
  it("builds, validates and re-imports a screen with rematched operations", () => {
    const built = buildScreenArtifact(project(), "s1");
    expect(built?.components.length).toBe(1);
    expect(built?.operations[0]?.operationKey).toBe("POST /sobjects/Lead");
    expect(buildScreenArtifact(project(), "nope")).toBeNull();

    const checked = parseScreenArtifact(JSON.parse(JSON.stringify(built)));
    expect(checked.ok).toBe(true);
    expect(parseScreenArtifact({ format: "nope" }).ok).toBe(false);

    const next = importScreenArtifact(project(), checked.artifact!);
    const screens = next.experience!.screens;
    expect(screens.length).toBe(2);
    expect(screens[1].name).toContain("(imported)");
    // Existing operation matched by key - no duplicate proposed.
    expect(next.apiCatalog!.operations.length).toBe(1);
    const rebound = next.experience!.bindings.find((b) => b.screenId === screens[1].id)!;
    expect(rebound.operationId).toBe("op1");
    expect(rebound.componentId).toBe(next.experience!.components.find((c) => c.screenId === screens[1].id)!.id);
  });

  it("proposes missing operations on import", () => {
    const built = buildScreenArtifact(project(), "s1")!;
    built.operations[0].operationKey = "POST /custom/leads";
    const bare = { ...project(), apiCatalog: { id: "api", operations: [], dependencies: [], updatedAt: "" } } as unknown as StudioProject;
    const next = importScreenArtifact(bare, built);
    expect(next.apiCatalog!.operations.length).toBe(1);
    expect(next.apiCatalog!.operations[0].lifecycle).toBe("proposed");
  });
});
