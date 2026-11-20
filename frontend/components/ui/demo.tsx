// Usage example for GradientMenu (kept for reference; not rendered by any page).
import { Flag, Gauge, Radio, Timer, Trophy } from "lucide-react";
import GradientMenu, { GRADIENTS } from "@/components/ui/gradient-menu";

export function DemoOne() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <GradientMenu active="/live" items={[
        { title: "Live", href: "/live", icon: <Radio />, ...GRADIENTS.red },
        { title: "Next race", href: "/next", icon: <Flag />, ...GRADIENTS.blue },
        { title: "Command", href: "/", icon: <Gauge />, ...GRADIENTS.carbon },
        { title: "Strategy", href: "/strategy", icon: <Timer />, ...GRADIENTS.redBlue },
        { title: "Picks", href: "/play", icon: <Trophy />, ...GRADIENTS.white },
      ]} />
    </div>
  );
}
