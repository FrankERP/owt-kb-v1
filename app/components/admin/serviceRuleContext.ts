import type { ServiceType } from "./serviceCardModel";

export interface WeekendRuleContext {
  owningSunday: string;
  month: string;
  sundayDates: string[];
  week: number | null;
  addressable: boolean;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDay(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return formatDate(date);
}

export function completeSundaySpine(month: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return [];

  const dates: string[] = [];
  const date = new Date(year, monthNumber - 1, 1, 12);
  while (date.getFullYear() === year && date.getMonth() === monthNumber - 1) {
    if (date.getDay() === 0) dates.push(formatDate(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

/**
 * Resolve week-exclusion context from the service target itself. A Saturday is
 * owned by its following Sunday, even when that crosses the displayed month.
 */
export function ruleContextForTarget(
  type: ServiceType,
  date: string,
): WeekendRuleContext | null {
  if (type === "special_role") return null;
  const owningSunday = type === "saturday_role" ? addDay(date) : date;
  const month = owningSunday.slice(0, 7);
  const sundayDates = completeSundaySpine(month);
  const index = sundayDates.indexOf(owningSunday);
  return {
    owningSunday,
    month,
    sundayDates,
    week: index === -1 ? null : index + 1,
    addressable: index !== -1,
  };
}

export function allWeekendTargetsAddressable(
  targets: readonly { type: ServiceType; date: string }[],
): boolean {
  return targets.every((target) => {
    const context = ruleContextForTarget(target.type, target.date);
    return context === null || context.addressable;
  });
}
