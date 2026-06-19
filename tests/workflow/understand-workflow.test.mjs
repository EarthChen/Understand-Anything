import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKFLOW_PATH = resolve(__dirname, '../../understand-anything-plugin/skills/understand/workflow.js')

function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, 'utf-8')
}

function parseMeta(content) {
  // Extract meta object from workflow.js
  const metaMatch = content.match(/export const meta\s*=\s*(\{[\s\S]*?\n\})/)
  if (!metaMatch) throw new Error('Could not parse meta from workflow.js')
  // Use Function constructor to evaluate the object literal
  return new Function(`return ${metaMatch[1]}`)()
}

describe('understand workflow', () => {
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
      expect(meta.name).toBe('understand')
    })

    it('should have description about knowledge graph', () => {
      const meta = parseMeta(readWorkflow())
      expect(meta.description).toContain('knowledge graph')
    })

    it('should have all required phases', () => {
      const meta = parseMeta(readWorkflow())
      const phaseTitles = meta.phases.map(p => p.title)
      expect(phaseTitles).toEqual([
        'Pre-flight',
        'Scan',
        'Structural',
        'Analyze',
        'Assemble',
        'Architecture',
        'Tour',
        'Review',
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
      expect(content).toContain("'outputLanguage'")
    })

    it('should define SCAN_SCHEMA', () => {
      const content = readWorkflow()
      expect(content).toContain('SCAN_SCHEMA')
      expect(content).toContain("'projectName'")
      expect(content).toContain("'languages'")
      expect(content).toContain("'frameworks'")
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
      expect(content).toContain("phase('Scan')")
      expect(content).toContain("phase('Analyze')")
      expect(content).toContain("phase('Assemble')")
      expect(content).toContain("phase('Architecture')")
      expect(content).toContain("phase('Tour')")
      expect(content).toContain("phase('Review')")
      expect(content).toContain("phase('Save')")
    })
  })

  describe('agent dispatch', () => {
    it('should dispatch project-scanner agent in Scan phase', () => {
      const content = readWorkflow()
      expect(content).toContain('project-scanner')
    })

    it('should dispatch architecture-analyzer agent in Architecture phase', () => {
      const content = readWorkflow()
      expect(content).toContain('architecture-analyzer')
    })

    it('should dispatch tour-builder agent in Tour phase', () => {
      const content = readWorkflow()
      expect(content).toContain('tour-builder')
    })

    it('should dispatch graph-reviewer agent in Review phase', () => {
      const content = readWorkflow()
      expect(content).toContain('graph-reviewer')
    })

    it('should dispatch assemble-reviewer agent in Assemble phase', () => {
      const content = readWorkflow()
      expect(content).toContain('assemble-reviewer')
    })
  })

  describe('argument handling', () => {
    it('should handle --full flag', () => {
      const content = readWorkflow()
      expect(content).toContain('--full')
    })

    it('should handle --review flag', () => {
      const content = readWorkflow()
      expect(content).toContain('--review')
    })

    it('should handle --language flag', () => {
      const content = readWorkflow()
      expect(content).toContain('--language')
    })

    it('should handle --auto-update flag', () => {
      const content = readWorkflow()
      expect(content).toContain('--auto-update')
    })
  })

  describe('output generation', () => {
    it('should write knowledge-graph.json', () => {
      const content = readWorkflow()
      expect(content).toContain('knowledge-graph.json')
    })

    it('should write meta.json', () => {
      const content = readWorkflow()
      expect(content).toContain('meta.json')
    })

    it('should include validation step', () => {
      const content = readWorkflow()
      expect(content).toContain('validate-artifact.mjs')
    })

    it('should include fingerprint generation', () => {
      const content = readWorkflow()
      expect(content).toContain('build-fingerprints.mjs')
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

    it('should return error on failure', () => {
      const content = readWorkflow()
      expect(content).toContain('success: false')
      expect(content).toContain('error:')
    })
  })

  describe('language support', () => {
    it('should support language directive', () => {
      const content = readWorkflow()
      expect(content).toContain('languageDirective')
    })

    it('should default to English', () => {
      const content = readWorkflow()
      expect(content).toMatch(/['"]en['"]/)
    })

    it('should read locale files', () => {
      const content = readWorkflow()
      expect(content).toContain('locales/')
    })
  })
})
