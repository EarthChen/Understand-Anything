import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WIKI_WORKFLOW_PATH = resolve(__dirname, '../../understand-anything-plugin/skills/understand-wiki/workflow.js')
const KG_INDEX_PATH = resolve(__dirname, '../../understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts')

function readWikiWorkflow() {
  return readFileSync(WIKI_WORKFLOW_PATH, 'utf-8')
}

function readKgIndex() {
  return readFileSync(KG_INDEX_PATH, 'utf-8')
}

describe('understand-wiki workflow fixes', () => {
  describe('workflow() not in agent prompt text', () => {
    it('kgPrompt should NOT contain workflow() call in its return string', () => {
      const content = readWikiWorkflow()

      const kgFuncStart = content.indexOf('function kgPrompt(svc)')
      const kgFuncEnd = content.indexOf('\n}\n', kgFuncStart)
      const kgFunc = content.slice(kgFuncStart, kgFuncEnd)

      // The return template literal should NOT contain workflow() calls
      // because sub-agents don't have access to the workflow() tool
      expect(kgFunc).not.toMatch(/return `[\s\S]*workflow\(\{/)
    })

    it('dgPrompt should NOT contain workflow() call in its return string', () => {
      const content = readWikiWorkflow()

      const dgFuncStart = content.indexOf('function dgPrompt(svc)')
      const dgFuncEnd = content.indexOf('\n}\n', dgFuncStart)
      const dgFunc = content.slice(dgFuncStart, dgFuncEnd)

      expect(dgFunc).not.toMatch(/return `[\s\S]*workflow\(\{/)
    })

    it('kgPrompt should be validation-only (no SKILL.md rebuild instructions)', () => {
      const content = readWikiWorkflow()

      const kgFuncStart = content.indexOf('function kgPrompt(svc)')
      const kgFuncEnd = content.indexOf('\n}\n', kgFuncStart)
      const kgFunc = content.slice(kgFuncStart, kgFuncEnd)

      // Agent should only validate, not rebuild
      expect(kgFunc).not.toMatch(/SKILL\.md/)
      expect(kgFunc).toMatch(/Do NOT build or rebuild/)
    })

    it('dgPrompt should be validation-only (no SKILL.md rebuild instructions)', () => {
      const content = readWikiWorkflow()

      const dgFuncStart = content.indexOf('function dgPrompt(svc)')
      const dgFuncEnd = content.indexOf('\n}\n', dgFuncStart)
      const dgFunc = content.slice(dgFuncStart, dgFuncEnd)

      expect(dgFunc).not.toMatch(/SKILL\.md/)
      expect(dgFunc).toMatch(/Do NOT build or rebuild/)
    })
  })

  describe('workflow() called directly in pipeline stages', () => {
    it('should call workflow() for KG build before agent validation', () => {
      const content = readWikiWorkflow()

      // The pipeline section should have a direct workflow() call for building KG
      const pipelineSection = content.slice(
        content.indexOf('// ─── Phase 1-4:'),
        content.indexOf('// ─── Phase 5:') !== -1 ? content.indexOf('// ─── Phase 5:') : content.length
      )

      // Should have a direct workflow({ name: 'understand' }) call
      expect(pipelineSection).toMatch(/workflow\(\{[^`]*name:\s*['"]understand['"]/)
    })

    it('should call workflow() for DG build before agent validation', () => {
      const content = readWikiWorkflow()

      const pipelineSection = content.slice(
        content.indexOf('// ─── Phase 1-4:'),
        content.indexOf('// ─── Phase 5:') !== -1 ? content.indexOf('// ─── Phase 5:') : content.length
      )

      expect(pipelineSection).toMatch(/workflow\(\{[^`]*name:\s*['"]understand-domain['"]/)
    })
  })

  describe('dgPrompt --language parameter', () => {
    it('DG workflow args should include outputLanguage', () => {
      const content = readWikiWorkflow()

      // Find the pipeline section
      const pipelineSection = content.slice(
        content.indexOf('// ─── Phase 1-4:')
      )
      // Check that the DG workflow section includes --language in the args construction
      const dgSection = pipelineSection.slice(
        pipelineSection.indexOf('understand-domain') - 500,
        pipelineSection.indexOf('understand-domain') + 500
      )
      expect(dgSection).toMatch(/outputLanguage|--language/)
    })
  })

  describe('staleness check is validation-only, no rebuild', () => {
    it('kgPrompt staleness section should NOT call workflow() or SKILL.md', () => {
      const content = readWikiWorkflow()

      const kgFuncStart = content.indexOf('function kgPrompt(svc)')
      const kgFuncEnd = content.indexOf('\n}\n', kgFuncStart)
      const kgFunc = content.slice(kgFuncStart, kgFuncEnd)

      const stalenessSection = kgFunc.slice(kgFunc.indexOf('Staleness check'))
      expect(stalenessSection).not.toMatch(/workflow\(\{/)
      expect(stalenessSection).not.toMatch(/SKILL\.md/)
      expect(stalenessSection).toMatch(/stale/)
    })

    it('dgPrompt staleness section should NOT call workflow() or SKILL.md', () => {
      const content = readWikiWorkflow()

      const dgFuncStart = content.indexOf('function dgPrompt(svc)')
      const dgFuncEnd = content.indexOf('\n}\n', dgFuncStart)
      const dgFunc = content.slice(dgFuncStart, dgFuncEnd)

      const stalenessSection = dgFunc.slice(dgFunc.indexOf('staleness check'))
      expect(stalenessSection).not.toMatch(/workflow\(\{/)
      expect(stalenessSection).not.toMatch(/SKILL\.md/)
      expect(stalenessSection).toMatch(/stale/)
    })
  })
})

describe('KgIndex factory pattern', () => {
  describe('static create method', () => {
    it('should have a static create() method', () => {
      const content = readKgIndex()
      expect(content).toMatch(/static\s+create\s*\(/)
    })

    it('constructor should NOT use definite assignment assertions', () => {
      const content = readKgIndex()
      const classStart = content.indexOf('export class KgIndex')
      const classBody = content.slice(classStart)
      expect(classBody).not.toMatch(/private miniSearch!:/)
      expect(classBody).not.toMatch(/private docs!:/)
    })

    it('constructor should always initialize miniSearch and docs', () => {
      const content = readKgIndex()
      const classStart = content.indexOf('export class KgIndex')
      const constructorStart = content.indexOf('constructor(', classStart)
      const constructorEnd = content.indexOf('\n  }', constructorStart)
      const constructor = content.slice(constructorStart, constructorEnd)

      // Both fields should be assigned in constructor (no early return without init)
      expect(constructor).toMatch(/this\.docs\s*=/)
      expect(constructor).toMatch(/this\.miniSearch\s*=/)
    })

    it('create() should handle cache hit by returning cached instance', () => {
      const content = readKgIndex()
      expect(content).toMatch(/static\s+create[\s\S]*cached[\s\S]*return cached/)
    })

    it('create() should handle cache miss by constructing new instance', () => {
      const content = readKgIndex()
      expect(content).toMatch(/static\s+create[\s\S]*new\s+KgIndex/)
    })
  })
})
