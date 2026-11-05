// app/mcp/oauth/__tests__/tier.test.ts
import { describe, it, expect } from "vitest";
import { mcpTierOf } from "../tier";
import { canUseAdminChat } from "@/app/utils/adminChat";
import type { MinistryId } from "@/app/ministries";

const ROLES = ["super-admin", "admin", "content-editor", "member", null, "unknown"] as const;
const MINISTRY_SETS: MinistryId[][] = [["worship"], ["kids"], ["jovenes"], ["worship", "kids"], ["kids", "jovenes"], []];

describe("mcpTierOf (ADR-0083)", () => {
  it("a super-admin is full, in any ministry", () => {
    for (const ministries of MINISTRY_SETS) {
      expect(mcpTierOf({ active: true, role: "super-admin", ministries })).toBe("full");
    }
  });

  it("an admin of worship is read; an admin outside worship is refused", () => {
    expect(mcpTierOf({ active: true, role: "admin", ministries: ["worship"] })).toBe("read");
    expect(mcpTierOf({ active: true, role: "admin", ministries: ["worship", "kids"] })).toBe("read");
    expect(mcpTierOf({ active: true, role: "admin", ministries: ["kids"] })).toBeNull();
    expect(mcpTierOf({ active: true, role: "admin", ministries: [] })).toBeNull();
  });

  it("content-editor, member, no role and unknown roles are refused", () => {
    for (const role of ["content-editor", "member", null, "unknown"]) {
      expect(mcpTierOf({ active: true, role, ministries: ["worship"] }), String(role)).toBeNull();
    }
  });

  it("an inactive (disabled or missing) member is refused, whatever the role", () => {
    for (const role of ROLES) {
      expect(mcpTierOf({ active: false, role, ministries: ["worship"] }), String(role)).toBeNull();
    }
  });

  it("for ACTIVE members, a connection exists exactly when the in-app assistant is allowed (same audience)", () => {
    for (const role of ROLES) {
      for (const ministries of MINISTRY_SETS) {
        expect(mcpTierOf({ active: true, role, ministries }) !== null, `${role} ${ministries.join("+")}`).toBe(
          canUseAdminChat({ role, ministries }),
        );
      }
    }
  });
});
