import { Layers, BadgeDollarSign, Gift, Clock, CalendarCheck, Send, Phone, type LucideIcon } from "lucide-react";
import { ACTION_FLAG_LABELS, type ActionFlag, type ActionPriority } from "@/lib/buyerIntelligence";
import { cn } from "@/lib/utils";

const FLAG_STYLE: Record<ActionFlag, { icon: LucideIcon; actionIcon: LucideIcon; className: string }> = {
  repeat_purchase: { icon: Layers, actionIcon: CalendarCheck, className: "flag-chip-repeat" },
  payment_milestone: { icon: BadgeDollarSign, actionIcon: Send, className: "flag-chip-milestone" },
  relationship_touchpoint: { icon: Gift, actionIcon: Gift, className: "flag-chip-touchpoint" },
  inactive_engagement: { icon: Clock, actionIcon: Phone, className: "flag-chip-inactive" },
};

const PRIORITY_STYLE: Record<ActionPriority, string> = {
  high: "priority-pill-high",
  medium: "priority-pill-medium",
  low: "priority-pill-low",
};

export function FlagChip({ flag }: { flag: ActionFlag }) {
  const { icon: Icon, className } = FLAG_STYLE[flag];
  return (
    <span className={cn("flag-chip", className)}>
      <Icon size={14} aria-hidden />
      {ACTION_FLAG_LABELS[flag]}
    </span>
  );
}

export function RecommendedAction({ flag, text }: { flag: ActionFlag; text: string }) {
  const Icon = FLAG_STYLE[flag].actionIcon;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      {text}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: ActionPriority }) {
  return <span className={cn("priority-pill", PRIORITY_STYLE[priority])}>{priority}</span>;
}
