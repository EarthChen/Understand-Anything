import InteractionDagView from "./InteractionDagView"
import { useBusinessStore } from "../stores/businessStore"
import { useDashboardStore } from "../store"

export default function BusinessDomainPanel({ domainId }: { domainId: string; accessToken?: string }) {
  const detail = useBusinessStore((s) => s.domainDetail[domainId])
  const setViewMode = useDashboardStore((s) => s.setViewMode)
  const setActiveService = useDashboardStore((s) => s.setActiveService)

  if (!detail) return null

  const serverServices = (detail.facets?.server as { services?: string[] } | undefined)?.services ?? []

  return (
    <aside className="w-[360px] shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-auto p-4">
      <h2 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{detail.name}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{detail.summary}</p>

      <section className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Interactions</h3>
        {detail.interactions.map((flow) => (
          <div key={flow.id} className="mb-4">
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{flow.name}</div>
            <InteractionDagView interaction={flow} />
          </div>
        ))}
        {detail.interactions.length === 0 && (
          <div className="text-xs text-gray-400 italic">No interactions</div>
        )}
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Business Rules</h3>
        <ul className="text-sm space-y-1">
          {detail.businessRules.map((r) => (
            <li key={r.id} className="text-gray-600 dark:text-gray-400">• {r.rule}</li>
          ))}
        </ul>
        {detail.businessRules.length === 0 && (
          <div className="text-xs text-gray-400 italic">No rules</div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cross-Mode Navigation</h3>
        {serverServices.map((svc) => (
          <button
            key={svc}
            type="button"
            data-testid={`nav-system-${svc}`}
            className="text-xs text-blue-600 dark:text-blue-400 block mb-1 hover:underline"
            onClick={() => { setActiveService(svc); setViewMode("business"); setViewMode("system"); }}
          >
            → System: {svc}
          </button>
        ))}
        {serverServices.length === 0 && (
          <div className="text-xs text-gray-400 italic">No linked services</div>
        )}
      </section>
    </aside>
  )
}
