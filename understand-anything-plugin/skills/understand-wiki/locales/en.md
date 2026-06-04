# English Wiki Output Guide

This file provides language guidance for generating Wiki documentation in English.

## Summary Style

- Domain summary: 3-5 sentences describing the business capability, core entities, key rules, and external dependencies
- Flow summary: 2-3 sentences describing the business goal, technical mechanisms, and cross-service interactions
- Step description: Tell the reader what the code DOES, not just what it IS

**Examples:**
- Good: "Validates the event type and user identity, locates the user's family by familyId, and silently drops the event if the user is not in an active family."
- Bad: "Validates the event."

## Ubiquitous Language

- Each term should have a clear, precise definition
- Use the actual class/enum names from code as terms
- Aim for 5-15 terms per domain

## Business Rules

- Write rules as clear declarative statements
- Include the enforcing class/method reference
- Example: `{ "id": "BR-001", "rule": "Page limit defaults to familySquarePageSize when empty or non-positive.", "enforcement": "FamilyWebServiceImpl.querySquareRecommend" }`

## Technical Terms

Keep framework-specific terms in English:
- `DTO`, `VO`, `Entity`, `Repository`, `Service`
- `Kafka`, `Redis`, `MySQL`, `Elasticsearch`
- `RPC`, `Dubbo`, `gRPC`, `REST API`
