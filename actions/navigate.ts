import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Move the user's screen. view=survey opens the map and review queue; add photoId to open a photo, proposalId to select a drafted edit, filter (pending, approved, conflict, uploaded, all) and center (\"lat,lon,zoom\").",
  schema: z.object({
    view: z.string().optional().describe("View name to navigate to"),
    path: z.string().optional().describe("URL path to navigate to"),
    threadId: z.string().optional().describe("Chat thread ID to open"),
    photoId: z.string().uuid().optional().describe("Survey photo to open"),
    proposalId: z.string().uuid().optional().describe("Drafted edit to select"),
    filter: z.enum(["pending", "approved", "conflict", "uploaded", "all"]).optional().describe("Review queue filter"),
    center: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?(,\d{1,2})?$/u).optional().describe('Map center "lat,lon" or "lat,lon,zoom"'),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("At least --view or --path is required.");
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.path) nav.path = args.path;
    if (args.threadId) nav.threadId = args.threadId;
    for (const key of ["photoId", "proposalId", "filter", "center"] as const) {
      const v = args[key];
      if (v) nav[key] = v;
    }
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}`;
  },
});
