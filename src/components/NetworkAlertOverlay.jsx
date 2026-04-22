import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertOctagon, Zap, ShieldAlert } from "lucide-react";

/**
 * NetworkAlertOverlay Component
 * Renders a premium, high-impact alert banner when critical network failures are detected.
 * Designed to provide a "Mission Control" sense of urgency.
 */
export function NetworkAlertOverlay({ observation }) {
  const activeAlarms = observation?.active_alarms || [];
  
  // Logic to determine if we are in a "Critical Alarm Storm" state
  const alertState = useMemo(() => {
    const criticals = activeAlarms.filter(a => a.severity === "CRITICAL");
    const powerFailures = activeAlarms.filter(a => a.node_id.startsWith("PWR_"));
    
    if (powerFailures.length > 0) {
      return {
        type: "POWER_FAILURE",
        label: "CRITICAL POWER FAILURE DETECTED",
        description: `Node ${powerFailures[0].node_id} is reporting a total voltage collapse. Cascading outages expected.`,
        icon: Zap,
        color: "text-red-500",
        bg: "bg-red-500/10",
        border: "border-red-500/20"
      };
    }
    
    if (criticals.length >= 5) {
      return {
        type: "ALARM_STORM",
        label: "ALARM STORM DETECTED",
        description: `${criticals.length} critical alarms propagated across multiple layers. Structural graph reasoning required.`,
        icon: AlertOctagon,
        color: "text-orange-500",
        bg: "bg-orange-500/10",
        border: "border-orange-500/20"
      };
    }

    if (criticals.length > 0) {
      return {
        type: "OUTAGE",
        label: "NETWORK OUTAGE DETECTED",
        description: `Critical fault detected in ${criticals[0].layer} layer. Root cause identification in progress.`,
        icon: ShieldAlert,
        color: "text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-amber-500/20"
      }
    }
    
    return null;
  }, [activeAlarms]);

  if (!alertState) return null;

  const Icon = alertState.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="relative z-50 mb-4 overflow-hidden"
      >
        <div className={`flex items-center gap-4 rounded-[1.25rem] border ${alertState.border} ${alertState.bg} px-6 py-4 backdrop-blur-xl`}>
          <div className="relative">
            <div className={`absolute inset-0 animate-ping rounded-full ${alertState.color.replace('text-', 'bg-')}/20`} />
            <div className={`relative flex h-10 w-10 items-center justify-center rounded-full bg-black/20 ${alertState.color}`}>
              <Icon size={20} />
            </div>
          </div>
          
          <div className="flex-1">
            <h3 className={`text-sm font-bold tracking-tight ${alertState.color}`}>
              {alertState.label}
            </h3>
            <p className="mt-1 text-xs font-medium text-cream/70">
              {alertState.description}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/20">
              <motion.div 
                animate={{ x: [-100, 100] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className={`h-full w-1/2 ${alertState.color.replace('text-', 'bg-')}`}
              />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase text-cream/40">
              Analyzing Signal...
            </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
