"use client";

import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Rows2, Rows3 } from "lucide-react";
import type { Preferences } from "@/lib/types";
import "./feed-view-menu.css";

type Density = Preferences["density"];

export default function FeedViewMenu({
  value,
  onValueChange,
}: {
  value: Density;
  onValueChange: (value: Density) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const Icon = value === "compact" ? Rows3 : Rows2;
  const label = value === "compact" ? "Compact" : "Card";

  async function selectView(next: string) {
    if (
      savingRef.current ||
      next === value ||
      (next !== "comfortable" && next !== "compact")
    )
      return;

    savingRef.current = true;
    setSaving(true);
    try {
      await onValueChange(next);
    } catch {
      // The shared action handler reports errors. Keep the saved selection.
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (!next || !savingRef.current) setOpen(next);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="feed-view-trigger"
          aria-label={`Post view: ${label}`}
          aria-disabled={saving}
          aria-busy={saving}
          title={`Post view: ${label}`}
        >
          <Icon size={19} aria-hidden="true" />
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="feed-view-menu"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          loop
        >
          <DropdownMenu.Label className="feed-view-label">
            View
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => void selectView(next)}
          >
            {[
              { value: "comfortable", label: "Card", icon: Rows2 },
              { value: "compact", label: "Compact", icon: Rows3 },
            ].map((item) => (
              <DropdownMenu.RadioItem
                key={item.value}
                value={item.value}
                className="feed-view-option"
                disabled={saving}
              >
                <item.icon size={19} aria-hidden="true" />
                <span>{item.label}</span>
                <DropdownMenu.ItemIndicator className="feed-view-check">
                  <Check size={16} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
