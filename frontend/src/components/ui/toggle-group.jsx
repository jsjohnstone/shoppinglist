import * as React from "react"
import { cn } from "@/lib/utils"

const ToggleGroup = React.forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("inline-flex rounded-md shadow-sm", className)}
    {...props}
  >
    {children}
  </div>
))
ToggleGroup.displayName = "ToggleGroup"

const ToggleGroupItem = React.forwardRef(
  ({ className, active, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex items-center px-4 py-2 text-sm font-medium border border-input focus:z-10 focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-ring",
        "first:rounded-l-md last:rounded-r-md",
        "-ml-px first:ml-0",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
)
ToggleGroupItem.displayName = "ToggleGroupItem"

export { ToggleGroup, ToggleGroupItem }
