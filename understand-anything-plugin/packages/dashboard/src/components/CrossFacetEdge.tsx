import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import { useState } from "react"

export default function CrossFacetEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  const [hover, setHover] = useState(false)
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const apiPath = typeof data?.apiPath === 'string' ? data.apiPath : undefined
  const method = typeof data?.method === 'string' ? data.method : undefined
  const confidence = typeof data?.confidence === 'number' ? data.confidence : undefined
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: "#3b82f6", strokeWidth: 2 }} />
      <EdgeLabelRenderer>
        <div
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          className="nodrag nopan pointer-events-auto"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {hover && apiPath && (
            <div className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 shadow">
              {method ?? "HTTP"} {apiPath}
              {confidence != null && <span className="text-gray-400 ml-1">({Math.round(confidence * 100)}%)</span>}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
