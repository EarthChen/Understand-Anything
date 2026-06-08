import { useBusinessStore } from "../stores/businessStore"

export default function BusinessModeHeader() {
  const domains = useBusinessStore((s) => s.domains)
  const facetFilter = useBusinessStore((s) => s.facetFilter)
  const setFacetFilter = useBusinessStore((s) => s.setFacetFilter)
  const searchQuery = useBusinessStore((s) => s.searchQuery)
  const setSearchQuery = useBusinessStore((s) => s.setSearchQuery)

  const allFacets = Array.from(
    new Set(domains.flatMap((d) => Object.keys(d.facets)))
  )

  return (
    <div className="flex items-center gap-2 p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex gap-1">
        <button
          type="button"
          className={`text-xs px-2 py-1 rounded ${!facetFilter ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" : "text-gray-600 dark:text-gray-400"}`}
          onClick={() => setFacetFilter(null)}
        >
          All
        </button>
        {allFacets.map((f) => (
          <button
            key={f}
            type="button"
            className={`text-xs px-2 py-1 rounded ${facetFilter === f ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" : "text-gray-600 dark:text-gray-400"}`}
            onClick={() => setFacetFilter(facetFilter === f ? null : f)}
          >
            {f}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Search domains..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="ml-auto text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 w-48"
      />
    </div>
  )
}
