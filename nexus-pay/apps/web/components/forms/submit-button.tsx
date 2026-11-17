import { Button } from "@nexus/ui";
import { cn } from "@nexus/ui";

interface SubmitButtonProps extends React.ComponentProps<typeof Button> {
  pending?: boolean;
  pendingLabel?: string;
}

export function SubmitButton({
  pending,
  pendingLabel = "Please wait",
  children,
  className,
  ...props
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      disabled={pending || props.disabled}
      className={cn("w-full", className)}
      {...props}
    >
      {pending ? (
        <>
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            aria-hidden="true"
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
