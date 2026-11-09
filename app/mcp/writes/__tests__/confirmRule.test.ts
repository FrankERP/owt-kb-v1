// ADR-0083 addendum (slice B §3.7): every model-visible destructive write carries the person-confirms
// rule, appended once at registration; app-only twins and non-destructive tools do not.
import { describe, expect, it, vi } from "vitest";

import { PERSON_CONFIRMS_RULE, confirmingServer, withConfirmRule } from "../confirmRule";

describe("withConfirmRule", () => {
  it("appends the rule to a model-visible destructive tool, after one space", () => {
    const out = withConfirmRule({ description: "Borra servicios.", annotations: { destructiveHint: true } });
    expect(out.description).toBe(`Borra servicios. ${PERSON_CONFIRMS_RULE}`);
  });

  it("treats a visibility list that includes «model» as model-visible", () => {
    const out = withConfirmRule({ description: "X.", annotations: { destructiveHint: true }, _meta: { ui: { visibility: ["model", "app"] } } });
    expect(out.description).toContain(PERSON_CONFIRMS_RULE);
  });

  it("a destructive tool with no description gets the rule alone", () => {
    const bare: { description?: string; annotations: { destructiveHint: boolean } } = { annotations: { destructiveHint: true } };
    expect(withConfirmRule(bare).description).toBe(PERSON_CONFIRMS_RULE);
  });

  it("is idempotent: registering twice never doubles the rule", () => {
    const once = withConfirmRule({ description: "X.", annotations: { destructiveHint: true } });
    const twice = withConfirmRule(once);
    expect(twice.description).toBe(once.description);
  });

  it("leaves app-only twins, non-destructive and unannotated tools untouched (same object)", () => {
    const app = { description: "X.", annotations: { destructiveHint: true }, _meta: { ui: { visibility: ["app"] } } };
    const notDestructive = { description: "X.", annotations: { destructiveHint: false } };
    const read = { description: "X.", annotations: { readOnlyHint: true } };
    const bare = { description: "X." };
    for (const c of [app, notDestructive, read, bare]) expect(withConfirmRule(c)).toBe(c);
  });

  it("does not mutate the config it is given", () => {
    const config = { description: "X.", annotations: { destructiveHint: true } };
    withConfirmRule(config);
    expect(config.description).toBe("X.");
  });
});

describe("confirmingServer", () => {
  it("passes every registerTool config through withConfirmRule and forwards the rest unchanged", () => {
    const registerTool = vi.fn(function (this: unknown, ..._args: unknown[]) { return this; });
    const other = vi.fn(function (this: unknown, ..._args: unknown[]) { return this; });
    const target = { registerTool, other, version: "1" };
    const server = confirmingServer(target as never) as unknown as typeof target;
    const handler = async () => ({ content: [] });

    server.registerTool("delete_x" as never, { description: "Borra.", annotations: { destructiveHint: true } } as never, handler as never);
    expect(registerTool).toHaveBeenCalledWith("delete_x", { description: `Borra. ${PERSON_CONFIRMS_RULE}`, annotations: { destructiveHint: true } }, handler);
    // Bound to the real server, not the proxy.
    expect(registerTool.mock.contexts[0]).toBe(target);

    expect((server.other as () => unknown)()).toBe(target);
    expect(server.version).toBe("1");
  });
});
