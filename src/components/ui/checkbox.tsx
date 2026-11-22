import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<
    React.ComponentProps<"button">,
    "type" | "role" | "onChange"
  > {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function Checkbox({
  className,
  checked = false,
  disabled = false,
  onCheckedChange,
  onClick,
  ...props
}: CheckboxProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!e.defaultPrevented && !disabled) {
      onCheckedChange?.(!checked);
    }
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      data-slot="checkbox"
      data-state={checked ? "checked" : "unchecked"}
      onClick={handleClick}
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-2 border-border bg-secondary-background text-main-foreground ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked && "bg-main text-main-foreground",
        className
      )}
      {...props}
    >
      {checked && <Check className="size-3.5 stroke-[3]" aria-hidden="true" />}
    </button>
  );
}

export { Checkbox };
