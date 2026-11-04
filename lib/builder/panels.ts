/**
 * Builder two-panel layout. Collapsed panels dock into the section rail, so
 * the grid only ever holds open panels: two share the row, one takes the
 * full width, none renders nothing and the Payload section rises to the top.
 */
export function builderGridClass(leftOpen: boolean, rightOpen: boolean): string {
  if (leftOpen && rightOpen) return "lg:grid-cols-2 lg:h-[620px]";
  if (leftOpen || rightOpen) return "lg:h-[620px]";
  return "";
}

export interface BuilderSectionAvailability {
  payload: boolean;
  test: boolean;
}

/**
 * Which lower builder sections can exist: Payload needs a connection plus
 * chosen fields, Test needs a generated payload. The rail disables the rest.
 */
export function builderSectionAvailability(
  connected: boolean,
  fieldCount: number,
  hasPayload: boolean,
): BuilderSectionAvailability {
  return { payload: connected && fieldCount > 0, test: hasPayload };
}
