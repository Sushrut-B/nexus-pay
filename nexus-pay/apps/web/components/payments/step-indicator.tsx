import { cn } from "@nexus/ui";

export function StepIndicator({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Progress">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full border text-[11px] font-semibold",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : active
                    ? "border-primary bg-accent text-primary"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                "font-medium",
                active || done ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step}
            </span>
            {index < steps.length - 1 ? (
              <span className="mx-1 hidden h-px w-6 bg-border sm:block" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
