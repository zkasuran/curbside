// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Edits that rest on what a sign says must rest on a recorded reading of that sign, matched by
// the server to the same map element. The model cannot talk its way past this.

import { fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownedBy, type Caller } from "./common.js";

/** A rename must be the same name in another order, or a near spelling (similarity at least this). */
export const RENAME_MIN_SIMILARITY = 0.8;
const SIGN_FACTS = ["name", "check_date", "survey:date"];

export async function assertReadingBacksEdit(
  who: Caller,
  edit: {
    photoId: string;
    kind: "modify" | "create";
    target: string | null;
    set: Record<string, string>;
    readingId?: string | undefined;
  },
): Promise<void> {
  const touchesSignFacts = SIGN_FACTS.some((k) => k in edit.set);
  if (edit.kind === "modify" && !touchesSignFacts) return;
  if (!edit.readingId)
    fail(
      edit.kind === "create"
        ? "A new place needs the readingId of its sign."
        : "A name or confirmation edit needs the readingId of the sign it rests on.",
      { errorCode: "reading_required", statusCode: 400 },
    );
  const [reading] = await getDb()
    .select()
    .from(schema.signReadings)
    .where(
      and(
        eq(schema.signReadings.id, edit.readingId),
        ownedBy(schema.signReadings, who),
        eq(schema.signReadings.photoId, edit.photoId),
      ),
    )
    .limit(1);
  if (!reading)
    fail("That reading is not from this photo.", {
      errorCode: "reading_not_found",
      statusCode: 404,
    });
  if (reading.legibility !== "clear")
    fail("A partly legible sign cannot back an edit.", {
      errorCode: "reading_partial",
      statusCode: 409,
    });

  if (edit.kind === "create") {
    if (reading.verdict !== "not_on_map")
      fail(
        `"${reading.text}" matched ${reading.matchTarget} on the map; propose a modify on it instead.`,
        {
          errorCode: "duplicate_feature",
          statusCode: 409,
        },
      );
    return;
  }
  if (reading.matchTarget !== edit.target || reading.verdict === "not_on_map")
    fail(
      `The reading "${reading.text}" did not match ${edit.target} (verdict ${reading.verdict}). Do not rename a different place; if the sign is a new business, propose kind create.`,
      { errorCode: "reading_mismatch", statusCode: 409 },
    );
  if ("name" in edit.set) {
    if (reading.verdict === "same")
      fail("The sign already matches the map name.", {
        errorCode: "no_change",
        statusCode: 409,
      });
    if (
      reading.verdict === "differs" &&
      (reading.similarity ?? 0) < RENAME_MIN_SIMILARITY
    )
      fail(
        `"${reading.text}" is too different from the map's "${reading.matchName}" to be a spelling fix. Zoom in on the sign and record it again; a different business is a new place, not a rename.`,
        { errorCode: "reading_too_different", statusCode: 409 },
      );
    // Case may be fixed (signs are often in capitals), letters may not.
    if (edit.set.name.toLocaleLowerCase() !== reading.text.toLocaleLowerCase())
      fail(
        `The new name must be what the sign reads ("${reading.text}"), with only its capitalisation changed.`,
        { errorCode: "name_not_read", statusCode: 409 },
      );
  }
}
