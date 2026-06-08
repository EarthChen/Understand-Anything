import type { BusinessDomainDetail } from "../stores/businessStore"

type Interaction = BusinessDomainDetail["interactions"][number]
type Step = Interaction["steps"][number]

const FACET_COLORS: Record<string, string> = {
  server: "#3b82f6",
  client: "#22c55e",
  frontend: "#f97316",
  mobile: "#a855f7",
}

function StepNode({ step }: { step: Step }) {
  const color = FACET_COLORS[step.facet] ?? "#6b7280"
  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${
        step.terminal ? "border-dashed" : "border-solid"
      }`}
      style={{ borderColor: color }}
    >
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-gray-700 dark:text-gray-300">{step.description}</span>
      <span className="text-[9px] text-gray-400">{step.facet}</span>
    </div>
  )
}

export default function InteractionDagView({ interaction }: { interaction: Interaction }) {
  const steps = interaction.steps ?? []

  if (steps.length === 0) {
    return <div className="text-xs text-gray-400 italic">No steps defined</div>
  }

  return (
    <div className="flex flex-col gap-1 pl-2 border-l-2 border-gray-200 dark:border-gray-600">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 w-4">{i + 1}</span>
          <StepNode step={step} />
        </div>
      ))}
    </div>
  )
}
