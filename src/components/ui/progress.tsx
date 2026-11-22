import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import * as React from "react";

import { cn } from "@/lib/utils";

interface ProgressProps
  extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
}

function Progress({
  className,
  indicatorClassName,
  value = 0,
  ...props
}: ProgressProps) {
  const numericValue = typeof value === "number" ? value : 0;
  const clamped = Math.max(0, Math.min(100, numericValue));

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clamped}
      className={cn(
        "relative h-3.5 w-full overflow-hidden rounded-base border-2 border-border bg-secondary-background",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Track className="h-full w-full">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn(
            "h-full bg-main transition-[width] duration-200 ease-out",
            indicatorClassName
          )}
          style={{ width: `${clamped}%` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
