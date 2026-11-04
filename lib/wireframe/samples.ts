import { newComponent } from "./registry";
import { newExperience, newScreen, type Experience } from "./model";

/**
 * Starter gallery for Wireframe Studio: a two-screen onboarding flow that
 * demonstrates the three binding states (existing, proposed) plus an
 * interaction intent - the exact workshop cut architects run with clients.
 */
export interface WireframeSample {
  name: string;
  hint: string;
  build: () => Experience;
}

function buildOnboarding(): Experience {
  const exp = newExperience("Sample: customer onboarding");
  const capture = newScreen("Capture details", 120, 120);
  const review = newScreen("Review & confirm", 640, 120);
  exp.screens = [capture, review];
  exp.components = [
    { ...newComponent("header", capture.id, "New Customer") },
    { ...newComponent("sffield", capture.id, "Customer name"), binding: { source: "salesforce", object: "Account", field: "Name" }, bindingState: "existing" },
    { ...newComponent("sffield", capture.id, "Industry"), binding: { source: "salesforce", object: "Account", field: "Industry" }, bindingState: "existing" },
    {
      ...newComponent("sfpicklist", capture.id, "Customer segment"),
      binding: { source: "salesforce", object: "Account", field: "Customer_Segment__c" },
      bindingState: "proposed",
      proposedField: { object: "Account", apiName: "Customer_Segment__c", label: "Customer Segment", type: "Picklist", values: ["Enterprise", "Commercial", "SMB"] },
    },
    {
      ...newComponent("button", capture.id, "Continue"),
      interaction: { trigger: "click", action: "navigate", target: review.id },
    },
    { ...newComponent("header", review.id, "Review & confirm") },
    { ...newComponent("table", review.id, "Order lines") },
    {
      ...newComponent("button", review.id, "Submit"),
      interaction: { trigger: "click", action: "save", target: "Account" },
    },
  ];
  return exp;
}

export const WIREFRAME_SAMPLES: WireframeSample[] = [
  {
    name: "Sample: customer onboarding",
    hint: "Two screens, bound fields, a proposed picklist, save intent.",
    build: buildOnboarding,
  },
];
