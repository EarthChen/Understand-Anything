import InteractionDagView from "./InteractionDagView"
import { useBusinessStore } from "../stores/businessStore"
import { useDashboardStore } from "../store"

export default function BusinessDomainPanel({ domainId }: { domainId: string }) {
  const detail = useBusinessStore((s) => s.domainDetail[domainId])
  const selectedDomain = useBusinessStore((s) => s.selectedDomain)
  const isLoading = useBusinessStore((s) => s.isLoading)
  const clearSelection = useBusinessStore((s) => s.clearSelection)
  const setViewMode = useDashboardStore((s) => s.setViewMode)
  const setActiveService = useDashboardStore((s) => s.setActiveService)

  const name = detail?.name ?? selectedDomain?.name ?? ""
  const summary = detail?.summary ?? selectedDomain?.summary ?? ""

  if (!name && !isLoading) return null

  const serverServices = (detail?.facets?.server as { services?: string[] } | undefined)?.services ?? []
  const interactions = detail?.interactions ?? []
  const businessRules = detail?.businessRules ?? []

  return (
    <aside className="w-[360px] shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-auto p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{name}</h2>
        <button
          type="button"
          onClick={clearSelection}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
        >
          ✕
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{summary}</p>

      {isLoading && !detail && (
        <div className="text-xs text-gray-400 italic mb-4">加载详情中...</div>
      )}

      {!detail && !isLoading && (
        <div className="text-xs text-amber-600 dark:text-amber-400 mb-4 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
          详情文件尚未生成。重新执行 /understand-business 可生成完整的交互文档。
        </div>
      )}

      {interactions.length > 0 && (
        <section className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Interactions</h3>
          {interactions.map((flow) => (
            <div key={flow.id} className="mb-4">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{flow.name}</div>
              <InteractionDagView interaction={flow} />
            </div>
          ))}
        </section>
      )}

      {businessRules.length > 0 && (
        <section className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Business Rules</h3>
          <ul className="text-sm space-y-1">
            {businessRules.map((r) => (
              <li key={r.id} className="text-gray-600 dark:text-gray-400">• {r.rule}</li>
            ))}
          </ul>
        </section>
      )}

      {serverServices.length > 0 && (
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
        </section>
      )}
    </aside>
  )
}
