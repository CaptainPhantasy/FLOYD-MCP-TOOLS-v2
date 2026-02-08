# AGENTS Index

This directory contains **31 standalone LLM agent specifications** - 20 derived from Gemini MCP tools, 10 derived from currently implemented MCP servers in this environment, and 1 MCP Lab quality assurance agent. Each agent is designed to be spawned as an independent agent with its own prompt, tools, and invocation patterns.

## Quick Reference - All 31 Agents

| Agent | Role | Source |
|-------|------|--------|
| [synthetic-user-horde](#1-synthetic_user_horde) | QA Orchestrator | Gemini Tools |
| [project-biographer](#2-project_biographer) | Project Historian | Gemini Tools |
| [stagnation-interceptor](#3-stagnation_interceptor) | Productivity Coach | Gemini Tools |
| [rot-predictor](#4-rot_predictor) | Supply Chain Analyst | Gemini Tools |
| [temporal-risk-assessor](#5-temporal_risk_assessor) | Code Archaeologist | Gemini Tools |
| [architectural-fitness-guard](#6-architectural_fitness_guard) | Automated Architect | Gemini Tools |
| [doc-drift-sentinel](#7-doc_drift_sentinel) | Documentation Guardian | Gemini Tools |
| [shadow-branch-explorer](#8-shadow_branch_explorer) | Research Scientist | Gemini Tools |
| [debt-collector](#9-debt_collector) | Technical Debt Accountant | Gemini Tools |
| [feature-impact-predictor](#10-feature_impact_predictor) | Senior Engineering Manager | Gemini Tools |
| [pre-commit-devils-advocate](#11-pre_commit_devils_advocate) | Adversarial Reviewer | Gemini Tools |
| [context-anchor](#12-context_anchor) | Mental State Librarian | Gemini Tools |
| [api-darwinism-sandbox](#13-api_darwinism_sandbox) | Interface Design Philosopher | Gemini Tools |
| [spec-first-enforcer](#14-spec_first_enforcer) | Methodology Enforcer | Gemini Tools |
| [dependency-time-machine](#15-dependency_time_machine) | Dependency Futurist | Gemini Tools |
| [user-persona-simulator](#16-user_persona_simulator) | UX Research Lab Director | Gemini Tools |
| [codebase-narrator](#17-codebase_narrator) | Project Diarist | Gemini Tools |
| [holistic-refactor-orchestrator](#18-holistic_refactor_orchestrator) | Refactoring Consultant | Gemini Tools |
| [hypothetical-execution](#19-hypothetical_execution) | Logic Philosopher | Gemini Tools |
| [scenario-forge](#20-scenario_forge) | Chaos Engineer | Gemini Tools |
| [code-archaeologist](#21-code_archaeologist) | Codebase Historian | context-singularity |
| [swarm-orchestrator](#22-swarm_orchestrator) | Multi-Agent Coordinator | hivemind-orchestrator |
| [metacognitive-reasoner](#23-metacognitive_reasoner) | Reflective Thinker | omega-agi |
| [pattern-scientist](#24-pattern_scientist) | Pattern Recognition Specialist | pattern-crystallizer |
| [diagnostic-surgeon](#25-diagnostic_surgeon) | System Troubleshooter | floyd-devtools |
| [refactoring-architect](#26-refactoring_architect) | Code Transformation Specialist | floyd-safe-ops + floyd-patch |
| [process-terminal-agent](#27-process_terminal_agent) | Process Orchestrator | floyd-terminal |
| [concept-weaver](#28-concept_weaver) | Knowledge Synthesizer | novel-concepts |
| [lab-concierge](#29-lab_concierge) | Resource Facilitator | lab-lead |
| [visual-analyst](#30-visual_analyst) | Visual Intelligence Specialist | zai-mcp-server |
| [mcp-test-auditor](#31-mcp_test_auditor) | Quality Assurance / Real-World Tester | MCP Lab |

## Part 1: Gemini Tool-Derived Agents (1-20)

### 1. synthetic_user_horde
- **File**: `synthetic-user-horde-agent.md`
- **Role**: QA Orchestrator / Multi-Agent Coordinator
- **Core Personality**: The "QA Director"
- **When to Invoke**: Testing features, APIs, or CLIs with multiple user personas
- **Key Tools**: floyd-terminal, hivemind-orchestrator, pattern-crystallizer, floyd-runner

### 2. project_biographer
- **File**: `project-biographer-agent.md`
- **Role**: Project Historian / Narrative Keeper
- **Core Personality**: The "Project Historian"
- **When to Invoke**: Starting sessions, documenting decisions, answering "why did we do this?"
- **Key Tools**: episodic-memory-bank, execution-trace-synthesizer, adaptive-context-compressor

### 3. stagnation_interceptor
- **File**: `stagnation-interceptor-agent.md`
- **Role**: Productivity Coach / Flow State Guardian
- **Core Personality**: The "Productivity Coach"
- **When to Invoke**: Starting work sessions, feeling stuck, tracking velocity
- **Key Tools**: floyd-devtools, floyd-runner, pattern-crystallizer

### 4. rot_predictor
- **File**: `rot-predictor-agent.md`
- **Role**: Supply Chain Analyst / Dependency Health Forecaster
- **Core Personality**: The "Supply Chain Analyst"
- **When to Invoke**: Adding dependencies, auditing package health, planning upgrades
- **Key Tools**: web-search-prime, pattern-crystallizer, episodic-memory-bank

### 5. temporal_risk_assessor
- **File**: `temporal-risk-assessor-agent.md`
- **Role**: Code Archaeologist / Risk Analyst
- **Core Personality**: The "Code Archaeologist"
- **When to Invoke**: Touching unfamiliar files, planning refactors, assessing file risk
- **Key Tools**: pattern-crystallizer, floyd-devtools/git_bisect, dependency_analyzer

### 6. architectural_fitness_guard
- **File**: `architectural-fitness-guard-agent.md`
- **Role**: Automated Architect / Governance Enforcer
- **Core Personality**: The "Senior Architect"
- **When to Invoke**: Validating architecture, checking for violations, defining rules
- **Key Tools**: monorepo-dependency-analyzer, floyd-devtools, context-singularity

### 7. doc_drift_sentinel
- **File**: `doc-drift-sentinel-agent.md`
- **Role**: Documentation Guardian / Semantic Synchronizer
- **Core Personality**: The "Technical Documentation Lead"
- **When to Invoke**: After code changes, before releases, auditing docs
- **Key Tools**: semantic-diff-validator, typescript_semantic_analyzer, floyd-patch

### 8. shadow_branch_explorer
- **File**: `shadow-branch-explorer-agent.md`
- **Role**: Research Scientist / Safe Experimentation Orchestrator
- **Core Personality**: The "Research Scientist"
- **When to Invoke**: Risky refactors, comparing approaches, proof-of-concepts
- **Key Tools**: floyd-patch, floyd-runner, git_bisect, test_generator

### 9. debt_collector
- **File**: `debt-collector-agent.md`
- **Role**: Technical Debt Accountant / Portfolio Manager
- **Core Personality**: The "Technical Debt Accountant"
- **When to Invoke**: Assessing debt, prioritizing payoff, planning refactors
- **Key Tools**: temporal-risk-assessor, pattern-crystallizer, dependency_analyzer

### 10. feature_impact_predictor
- **File**: `feature-impact-predictor-agent.md`
- **Role**: Senior Engineering Manager / Impact Analyst
- **Core Personality**: The "Senior Engineering Manager"
- **When to Invoke**: Planning features, estimating effort, assessing complexity
- **Key Tools**: impact_simulate, temporal-risk-assessor, debt-collector

### 11. pre_commit_devils_advocate
- **File**: `pre-commit-devils-advocate-agent.md`
- **Role**: Adversarial Reviewer / Critical Thinking Partner
- **Core Personality**: The "Adversarial Reviewer"
- **When to Invoke**: Before committing, sanity checks, challenging assumptions
- **Key Tools**: semantic-diff-validator, typescript_semantic_analyzer, impact_simulate

### 12. context_anchor
- **File**: `context-anchor-agent.md`
- **Role**: Mental State Librarian / Context Manager
- **Core Personality**: The "Mental State Librarian"
- **When to Invoke**: Saving context before breaks, restoring after absences
- **Key Tools**: execution-trace-synthesizer, adaptive-context-compressor, episodic-memory-bank

### 13. api_darwinism_sandbox
- **File**: `api-darwinism-sandbox-agent.md`
- **Role**: Interface Design Philosopher / Ergonomics Analyst
- **Core Personality**: The "Interface Design Philosopher"
- **When to Invoke**: Designing APIs, choosing between designs, validating ergonomics
- **Key Tools**: RLM, typescript_semantic_analyzer, context-singularity

### 14. spec_first_enforcer
- **File**: `spec-first-enforcer-agent.md`
- **Role**: Methodology Enforcer / Development Discipline Coach
- **Core Personality**: The "Methodology Enforcer"
- **When to Invoke**: Starting features, validating specs, checking compliance
- **Key Tools**: test_generator, context-singularity, dependency_analyzer

### 15. dependency_time_machine
- **File**: `dependency-time-machine-agent.md`
- **Role**: Dependency Futurist / Trend Analyst
- **Core Personality**: The "Dependency Futurist"
- **When to Invoke**: Forecasting dependency futures, planning roadmaps
- **Key Tools**: web-search-prime, pattern-crystallizer, episodic-memory-bank

### 16. user_persona_simulator
- **File**: `user-persona-simulator-agent.md`
- **Role**: UX Research Lab Director / Empathic Tester
- **Core Personality**: The "UX Research Lab Director"
- **When to Invoke**: Testing UX, validating flows, finding friction points
- **Key Tools**: hivemind-orchestrator, context-singularity

### 17. codebase_narrator
- **File**: `codebase-narrator-agent.md`
- **Role**: Project Diarist / Literary Technical Writer
- **Core Personality**: The "Project Diarist"
- **When to Invoke**: Documenting sessions, writing DEV_JOURNAL entries
- **Key Tools**: execution-trace-synthesizer, episodic-memory-bank, adaptive-context-compressor

### 18. holistic_refactor_orchestrator
- **File**: `holistic-refactor-orchestrator-agent.md`
- **Role**: Refactoring Consultant / Safe Transformation Expert
- **Core Personality**: The "Refactoring Consultant"
- **When to Invoke**: Planning refactors, validating safety, executing transformations
- **Key Tools**: refactoring-orchestrator, impact_simulate, shadow_branch_explorer

### 19. hypothetical_execution
- **File**: `hypothetical-execution-agent.md`
- **Role**: Logic Philosopher / Thought Experiment Specialist
- **Core Personality**: The "Logic Philosopher"
- **When to Invoke**: Reasoning through code without execution, exploring edge cases
- **Key Tools**: RLM, context-singularity, typescript_semantic_analyzer

### 20. scenario_forge
- **File**: `scenario-forge-agent.md`
- **Role**: Chaos Engineer / Edge Case Generator
- **Core Personality**: The "Chaos Engineer"
- **When to Invoke**: Generating adversarial tests, finding edge cases
- **Key Tools**: test_generator, pattern-crystallizer, context-singularity

## Part 2: MCP Server-Derived Agents (21-30)

### 21. code_archaeologist
- **File**: `code-archaeologist-agent.md`
- **Role**: Codebase Historian / Semantic Index Maintainer
- **Core Personality**: The "Code Archaeologist"
- **Source MCP**: context-singularity (10 tools)
- **When to Invoke**: Understanding impact of changes, tracing code origins, deep codebase context
- **Key Tools**: ingest_file, ingest_codebase, ask, search, explain, find_impact, trace_origin, summarize_context

### 22. swarm_orchestrator
- **File**: `swarm-orchestrator-agent.md`
- **Role**: Multi-Agent Coordinator / Task Distribution Manager
- **Core Personality**: The "Swarm Coordinator"
- **Source MCP**: hivemind-orchestrator (12 tools)
- **When to Invoke**: Distributing work across agents, tracking task completion, building consensus
- **Key Tools**: register_agent, submit_task, get_task_status, assign_tasks, build_consensus

### 23. metacognitive_reasoner
- **File**: `metacognitive-reasoner-agent.md`
- **Role**: Reflective Thinker / Self-Improving Philosopher
- **Core Personality**: The "Metacognitive Reasoner"
- **Source MCP**: omega-agi (8 tools)
- **When to Invoke**: Deep multi-step reasoning, multiple perspectives, consensus building
- **Key Tools**: think, rlm, consensus, learn, reflect, evolve

### 24. pattern_scientist
- **File**: `pattern-scientist-agent.md`
- **Role**: Pattern Recognition Specialist / Abstraction Extractor
- **Core Personality**: The "Pattern Scientist"
- **Source MCP**: pattern-crystallizer (7 tools)
- **When to Invoke**: Detecting patterns, extracting abstractions, validating patterns
- **Key Tools**: detect_and_crystallize, extract_pattern, adapt_pattern, validate_pattern, list_crystallized

### 25. diagnostic_surgeon
- **File**: `diagnostic-surgeon-agent.md`
- **Role**: System Troubleshooter / Root Cause Analyst
- **Core Personality**: The "Diagnostic Surgeon"
- **Source MCP**: floyd-devtools (10 tools)
- **When to Invoke**: Build failures, test failures, dependency issues, performance problems
- **Key Tools**: dependency_analyzer, build_error_correlator, git_bisect, test_generator, benchmark_runner

### 26. refactoring_architect
- **File**: `refactoring-architect-agent.md`
- **Role**: Code Transformation Specialist / Safety-First Refactor
- **Core Personality**: The "Refactoring Architect"
- **Source MCP**: floyd-safe-ops (3 tools) + floyd-patch (5 tools)
- **When to Invoke**: Safe refactoring, impact simulation, patch verification
- **Key Tools**: safe_refactor, impact_simulate, verify, apply_unified_diff, assess_patch_risk

### 27. process_terminal_agent
- **File**: `process-terminal-agent.md`
- **Role**: Process Orchestrator / Session Manager
- **Core Personality**: The "Process Terminal"
- **Source MCP**: floyd-terminal (10 tools)
- **When to Invoke**: Managing long-running processes, multi-process workflows, session management
- **Key Tools**: start_process, interact_with_process, read_process_output, list_sessions, force_terminate

### 28. concept_weaver
- **File**: `concept-weaver-agent.md`
- **Role**: Knowledge Synthesizer / Memory Architect
- **Core Personality**: The "Concept Weaver"
- **Source MCP**: novel-concepts (10 tools)
- **When to Invoke**: Connecting concepts, episodic memory, analogy synthesis, context compression
- **Key Tools**: concept_web_weaver, episodic_memory_bank, analogy_synthesizer, adaptive_context_compressor

### 29. lab_concierge
- **File**: `lab-concierge-agent.md`
- **Role**: Resource Facilitator / Lab Manager
- **Core Personality**: The "Lab Concierge"
- **Source MCP**: lab-lead (6 tools)
- **When to Invoke**: Finding tools, discovering capabilities, spawning agents, lab inventory
- **Key Tools**: lab_inventory, lab_find_tool, lab_get_server_info, lab_spawn_agent, lab_sync_knowledge

### 30. visual_analyst
- **File**: `visual-analyst-agent.md`
- **Role**: Visual Intelligence Specialist / Multi-Modal Interpreter
- **Core Personality**: The "Visual Analyst"
- **Source MCP**: zai-mcp-server (8 tools)
- **When to Invoke**: Screenshot analysis, text extraction, diagram understanding, data visualization analysis
- **Key Tools**: ui_to_artifact, extract_text_from_screenshot, diagnose_error_screenshot, understand_technical_diagram, analyze_data_visualization

## Part 3: MCP Lab Agents (31)

### 31. mcp_test_auditor
- **File**: `mcp-test-auditor-agent.md`
- **Role**: Quality Assurance / Real-World Usability Tester
- **Core Personality**: The "MCP Test Auditor"
- **Source**: MCP Lab (all servers)
- **When to Invoke**: Validating MCP servers work correctly, testing tool functionality with real use cases, assessing new tools before deployment
- **Key Tools**: All MCP tools for testing purposes
- **Special**: Tests with real codebases and real data, not synthetic test scenarios

## Tools That Remain as MCP Tools (Not Agents)

### From Gemini Tools (3)
1. **dependency_hologram** - Visualization tool, single-purpose - AVAILABLE as `gemini-tools-server`
2. **failure_to_test_transmuter** - Deterministic transformation - AVAILABLE as `gemini-tools-server`
3. **trace_replay_debugger** - Specialized utility - AVAILABLE as `gemini-tools-server`

**Note:** These 3 tools are now fully implemented as MCP tools in `gemini-tools-server` and can be used by any MCP stdio-compatible LLM or application.

### From Current MCP Servers (16)
- **floyd-runner** (6 tools) - Straightforward project operations
- **floyd-supercache** (12 tools) - Pure cache operations
- **web-reader** (1 tool) - Single-purpose URL fetching
- **web-search-prime** (1 tool) - Single-purpose search
- **zread** (3 tools) - Document search and reading

## Agent File Structure

Each agent file contains:
- Agent type and core personality
- When to invoke the agent
- Full agent prompt (ready to use as a system message)
- Tools available to the agent (from the MCP environment)
- Example invocations
- Integration notes

## Usage

To use these agents:
1. Read the specific agent file for full details
2. Use the "When to Invoke" section to determine if the agent is appropriate
3. Use the agent prompt as the system message when spawning the agent
4. Ensure the agent has access to the listed tools

---

**Generated**: 2026-02-08
**Total Agents**: 31
**Part 1 Source**: 23 Gemini MCP Tools in `/docs/GEMINI_MCP_TOOLS_PRODUCTION_READY_2026.md`
**Part 2 Source**: Current MCP servers in this environment
**Analysis Method**: OMEGA v2 Consensus with agent-architect evaluation
