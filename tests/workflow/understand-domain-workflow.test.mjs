import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKFLOW_PATH = resolve(__dirname, '../../understand-anything-plugin/skills/understand-domain/workflow.js')

function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, 'utf-8')
}

function parseMeta(content) {
  const metaMatch = content.match(/export const meta\s*=\s*(\{[\s\S]*?\n\})/)
  if (!metaMatch) throw new Error('Could not parse meta from workflow.js')
  return new Function(`return ${metaMatch[1]}`)()
}

describe('understand-domain workflow', () => {
  describe('file structure', () => {
    it('should exist', () => {
      expect(existsSync(WORKFLOW_PATH)).toBe(true)
    })

    it('should export meta object', () => {
      const content = readWorkflow()
      expect(content).toContain('export const meta')
    })
  })

  describe('meta configuration', () => {
    it('should have correct name', () => {
      const meta = parseMeta(readWorkflow())
      expect(meta.name).toBe('understand-domain')
    })

    it('should have description about domain', () => {
      const meta = parseMeta(readWorkflow())
      expect(meta.description).toContain('domain')
    })

    it('should have all required phases', () => {
      const meta = parseMeta(readWorkflow())
      const phaseTitles = meta.phases.map(p => p.title)
      expect(phaseTitles).toEqual([
        'Pre-flight',
        'Detect',
        'Scan',
        'Discovery',
        'Extraction',
        'Merge',
        'Validate',
        'Save',
      ])
    })

    it('should have detail for each phase', () => {
      const meta = parseMeta(readWorkflow())
      for (const phase of meta.phases) {
        expect(phase.detail).toBeTruthy()
        expect(typeof phase.detail).toBe('string')
      }
    })
  })

  describe('schema definitions', () => {
    it('should define PREFLIGHT_SCHEMA', () => {
      const content = readWorkflow()
      expect(content).toContain('PREFLIGHT_SCHEMA')
      expect(content).toContain("'projectRoot'")
      expect(content).toContain("'pluginRoot'")
    })

    it('should define DETECT_SCHEMA', () => {
      const content = readWorkflow()
      expect(content).toContain('DETECT_SCHEMA')
      expect(content).toContain("'kgStatus'")
      expect(content).toContain("'path'")
    })

    it('should define DISCOVERY_SCHEMA', () => {
      const content = readWorkflow()
      expect(content).toContain('DISCOVERY_SCHEMA')
      expect(content).toContain("'domainsCount'")
    })

    it('should define EXTRACTION_SCHEMA', () => {
      const content = readWorkflow()
      expect(content).toContain('EXTRACTION_SCHEMA')
      expect(content).toContain("'extractedCount'")
    })

    it('should define SAVE_SCHEMA', () => {
      const content = readWorkflow()
      expect(content).toContain('SAVE_SCHEMA')
      expect(content).toContain("'success'")
      expect(content).toContain("'outputPath'")
    })
  })

  describe('phase execution', () => {
    it('should call phase() for each phase', () => {
      const content = readWorkflow()
      expect(content).toContain("phase('Pre-flight')")
      expect(content).toContain("phase('Detect')")
      expect(content).toContain("phase('Scan')")
      expect(content).toContain("phase('Discovery')")
      expect(content).toContain("phase('Extraction')")
      expect(content).toContain("phase('Merge')")
      expect(content).toContain("phase('Validate')")
      expect(content).toContain("phase('Save')")
    })
  })

  describe('agent dispatch', () => {
    it('should dispatch domain-discoverer agent', () => {
      const content = readWorkflow()
      expect(content).toContain('domain-discoverer')
    })

    it('should dispatch domain-flow-extractor agent', () => {
      const content = readWorkflow()
      expect(content).toContain('domain-flow-extractor')
    })
  })

  describe('knowledge graph handling', () => {
    it('should validate KG completeness', () => {
      const content = readWorkflow()
      expect(content).toContain('validate-artifact.mjs')
      expect(content).toContain('knowledge-graph:complete')
    })

    it('should support standalone mode when KG is missing', () => {
      const content = readWorkflow()
      expect(content).toContain('--standalone')
      expect(content).toContain('standalone')
    })

    it('should rebuild degraded KG via understand skill', () => {
      const content = readWorkflow()
      expect(content).toContain('rebuild')
      expect(content).toContain('understand skill')
    })

    it('should derive from existing KG', () => {
      const content = readWorkflow()
      expect(content).toContain('derive')
      expect(content).toContain('condense_kg_for_domain.py')
    })
  })

  describe('platform detection', () => {
    it('should detect backend platform', () => {
      const content = readWorkflow()
      expect(content).toContain('backend')
    })

    it('should detect frontend platform', () => {
      const content = readWorkflow()
      expect(content).toContain('frontend')
    })

    it('should detect mobile-client platform', () => {
      const content = readWorkflow()
      expect(content).toContain('mobile-client')
    })

    it('should detect fullstack platform', () => {
      const content = readWorkflow()
      expect(content).toContain('fullstack')
    })

    it('should load platform-specific strategy', () => {
      const content = readWorkflow()
      expect(content).toContain('platforms/backend-flow.md')
      expect(content).toContain('platforms/frontend-flow.md')
      expect(content).toContain('platforms/mobile-flow.md')
    })
  })

  describe('domain discovery', () => {
    it('should support checkpoint detection', () => {
      const content = readWorkflow()
      expect(content).toContain('checkpoint')
      expect(content).toContain('domain-discovery-checkpoint.json')
    })

    it('should run audit after discovery', () => {
      const content = readWorkflow()
      expect(content).toContain('audit_domain_discovery.py')
    })

    it('should refine discovery if audit fails', () => {
      const content = readWorkflow()
      expect(content).toContain('shouldRefine')
      expect(content).toMatch(/refin(e|ement)/)
    })
  })

  describe('flow extraction', () => {
    it('should run extraction in parallel', () => {
      const content = readWorkflow()
      expect(content).toContain('concurrent')
    })

    it('should handle extraction failure with retry', () => {
      const content = readWorkflow()
      expect(content).toContain('Retry once on failure')
    })

    it('should skip documentation-only domains', () => {
      const content = readWorkflow()
      expect(content).toContain('docs/')
      expect(content).toContain('documentation')
    })
  })

  describe('output generation', () => {
    it('should write domain-graph.json', () => {
      const content = readWorkflow()
      expect(content).toContain('domain-graph.json')
    })

    it('should merge domain results', () => {
      const content = readWorkflow()
      expect(content).toContain('merge_domain_results.py')
    })

    it('should validate domain graph', () => {
      const content = readWorkflow()
      expect(content).toContain('validate-graph.mjs')
    })
  })

  describe('error handling', () => {
    it('should handle plugin root not found', () => {
      const content = readWorkflow()
      expect(content).toContain('Cannot find plugin root')
    })

    it('should handle invalid project directory', () => {
      const content = readWorkflow()
      expect(content).toContain('Invalid project directory')
    })

    it('should error when KG missing without standalone', () => {
      const content = readWorkflow()
      expect(content).toContain('Knowledge graph not found')
    })

    it('should handle zero domains discovered', () => {
      const content = readWorkflow()
      expect(content).toContain('No domains found')
    })
  })
})
