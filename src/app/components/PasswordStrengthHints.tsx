import { Check, Circle } from "lucide-react";
import { cn } from "./ui/utils";

interface PasswordStrengthHintsProps {
  password: string;
}

export function PasswordStrengthHints({ password }: PasswordStrengthHintsProps) {
  if (!password) return null;

  const requirements = [
    { label: "12+ characters", met: password.length >= 12 },
    { label: "Uppercase letter (A–Z)", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter (a–z)", met: /[a-z]/.test(password) },
    { label: "Number or symbol", met: /[^a-zA-Z]/.test(password) },
  ];

  return (
    <div className="mt-1.5 space-y-1 pl-1">
      {requirements.map((req) => (
        <div
          key={req.label}
          className={cn(
            "flex items-center gap-1.5 text-xs transition-colors duration-300",
            req.met ? "text-green-400" : "text-white/40",
          )}
        >
          {req.met ? (
            <Check className="w-3 h-3 shrink-0" />
          ) : (
            <Circle className="w-3 h-3 shrink-0" />
          )}
          {req.label}
        </div>
      ))}
    </div>
  );
}
