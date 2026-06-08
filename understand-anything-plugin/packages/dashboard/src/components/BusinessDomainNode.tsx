import { memo } from "react"
import type { NodeProps } from "@xyflow/react"

export interface BusinessDomainNodeData {
  label: string
  summary: string
  facets: string[]
  implType?: string
  domainId: string
  [key: string]: unknown
}

function BusinessDomainNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as BusinessDomainNodeData
  return (
    <div
      className={`rounded-lg border-2 p-3 min-w-[280px] bg-white dark:bg-gray-800 ${
        selected ? "border-blue-500" : "border-gray-300 dark:border-gray-600"
      }`}
      data-testid={`domain-node-${nodeData.domainId}`}
    >
      <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{nodeData.label}</div>
      {nodeData.implType && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{nodeData.implType}</span>
      )}
      <div className="flex gap-1 mt-2 flex-wrap">
        {nodeData.facets.map((f) => (
          <span key={f} className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
            {f}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{nodeData.summary}</p>
    </div>
  )
}
export default memo(BusinessDomainNode)
